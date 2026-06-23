const readline = require("readline");
const pino = require("pino");
const { Pool } = require("pg");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("@whiskeysockets/baileys");

// ---------- PostgreSQL session storage (free) ----------
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

// -------------------------------------------------------

async function startBot() {

    // Use the custom state instead of file-based
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

    // If no credentials exist, prompt for pairing code (only once)
    if (!state.creds.registered) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(
            "Enter phone number with country code: ",
            async (number) => {
                try {
                    const code = await sock.requestPairingCode(number);
                    console.log("");
                    console.log("PAIRING CODE:");
                    console.log(code);
                    console.log("");
                    console.log(
                        "WhatsApp > Linked Devices > Link with phone number"
                    );
                } catch (err) {
                    console.log(err);
                }
                rl.close();
            }
        );
    }

    sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            console.log("Bot connected.");
        }
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Disconnected. Reconnecting...");
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;
        if (msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

        try {
            await sock.sendPresenceUpdate("composing", jid);
            await sock.sendMessage(jid, {
                react: { text: "⚡", key: msg.key }
            });

            if (text === ".menu") {
                await sock.sendMessage(jid, {
                    text:
`╭─❍ BOT
├ .menu
├ .ping
├ .owner
├ .away
╰────────`
                });
            }

            if (text === ".ping") {
                await sock.sendMessage(jid, { text: "Pong ⚡" });
            }

            if (text === ".away" || text === ".owner" || text.toLowerCase().includes("veldrix")) {
                await sock.sendMessage(jid, { text: "Veldrix is not online." });
            }
        } catch (e) {
            console.log(e);
        }
    });
}

startBot();
