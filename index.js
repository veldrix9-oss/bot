const readline = require("readline");
const pino = require("pino");
const { Pool } = require("pg");

const {
    default: makeWASocket,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("@whiskeysockets/baileys");

// ---------- PostgreSQL setup (FREE) ----------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

let credsStore = null;

async function getCreds() {
    if (credsStore) return credsStore;
    try {
        const res = await pool.query('SELECT data FROM session WHERE id = $1', ['whatsapp']);
        if (res.rows.length > 0) {
            credsStore = JSON.parse(res.rows[0].data);
        } else {
            credsStore = {};
        }
    } catch (e) {
        // Table doesn't exist – create it
        await pool.query(`
            CREATE TABLE IF NOT EXISTS session (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            )
        `);
        credsStore = {};
    }
    return credsStore;
}

async function saveCreds(creds) {
    credsStore = creds;
    await pool.query(
        'INSERT INTO session (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
        ['whatsapp', JSON.stringify(creds)]
    );
}

// ---------- Main bot ----------
let isPairing = false; // Stops the reconnect loop while pairing

async function startBot() {
    const state = {
        creds: await getCreds(),
        saveCreds: saveCreds
    };

    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" })
    });

    sock.ev.on("creds.update", saveCreds);

    // Pairing flow – ONLY runs ONCE the very first time
    if (!state.creds.registered && !isPairing) {
        isPairing = true;
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question("Enter phone number with country code: ", async (number) => {
            try {
                const code = await sock.requestPairingCode(number);
                console.log("\n✅ PAIRING CODE:", code);
                console.log("\n📱 Open WhatsApp > Settings > Linked Devices > Link with phone number");
                console.log("➡️  Enter the code above to connect instantly.");
            } catch (err) {
                console.error("❌ Pairing error:", err);
            }
            rl.close();
            // After pairing, restart bot to load new credentials
            setTimeout(() => {
                isPairing = false;
                startBot();
            }, 3000);
        });
    }

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            console.log("✅ Bot connected successfully!");
        }
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect && !isPairing) {
                console.log("🔄 Disconnected. Reconnecting...");
                startBot();
            } else if (isPairing) {
                // Silently wait for pairing input
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const text = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text || "";

        try {
            await sock.sendPresenceUpdate("composing", jid);
            await sock.sendMessage(jid, { react: { text: "⚡", key: msg.key } });

            if (text === ".menu") {
                await sock.sendMessage(jid, {
                    text: `╭─❍ BOT\n├ .menu\n├ .ping\n├ .owner\n├ .away\n╰────────`
                });
            }
            if (text === ".ping") {
                await sock.sendMessage(jid, { text: "Pong ⚡" });
            }
            if (text === ".away" || text === ".owner" || text.toLowerCase().includes("veldrix")) {
                await sock.sendMessage(jid, { text: "Veldrix is not online." });
            }
        } catch (e) {
            console.error(e);
        }
    });
}

// Remove the warning
process.setMaxListeners(20);

startBot();
