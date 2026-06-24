const readline = require("readline");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

let sock, saveCreds;
let isPairing = false;

async function startBot() {
    const { state, saveCreds: save } = await useMultiFileAuthState("./session");
    saveCreds = save;

    // 1. Fetch the absolute latest version (ensures compatibility)
    let version;
    try {
        const fetched = await fetchLatestBaileysVersion();
        version = fetched.version;
        console.log(`📡 Using WhatsApp version: ${version.join('.')}`);
    } catch {
        // Fallback to a known good version if fetch fails
        version = [2, 3000, 1015906];
        console.log(`📡 Using fallback version: ${version.join('.')}`);
    }

    // 2. Socket with modern settings
    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeout: 120000,          // 2 minutes
        defaultQueryTimeoutMs: 120000,
        syncFullHistory: false,           // speed up connection
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 30000       // keep connection alive
    });

    sock.ev.on("creds.update", saveCreds);

    // 3. Connection handler – with reconnection and pairing prevention
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log("✅ Connection established.");
            // Only start pairing if not registered and not already pairing
            if (!state.creds.registered && !isPairing) {
                // Wait a moment for socket to stabilize
                setTimeout(startPairing, 3000);
            }
        }

        if (connection === "close") {
            if (isPairing) {
                console.log("⏳ Waiting for pairing input... (ignore disconnect)");
                return;
            }
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting in 10s... (network issue?)");
                setTimeout(startBot, 10000);
            } else {
                console.log("❌ Logged out. Delete session folder and restart.");
            }
        }
    });

    // 4. Message handler (unchanged, but fast)
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

        try {
            // Fire‑and‑forget presence and reaction for speed
            sock.sendPresenceUpdate("composing", jid).catch(() => {});
            sock.sendMessage(jid, { react: { text: "⚡", key: msg.key } }).catch(() => {});

            // Command processing
            if (text === ".menu") {
                await sock.sendMessage(jid, {
                    text: `╭─❍ BOT\n├ .menu\n├ .ping\n├ .owner\n├ .away\n╰────────`
                });
            } else if (text === ".ping") {
                await sock.sendMessage(jid, { text: "Pong ⚡" });
            } else if (text === ".away" || text === ".owner" || text.toLowerCase().includes("veldrix")) {
                await sock.sendMessage(jid, { text: "Veldrix is not online." });
            }
        } catch (e) {
            console.log(e);
        }
    });

    if (state.creds.registered) {
        console.log("✅ Session found – waiting for connection...");
    }
}

// 5. Pairing function – called only after connection is open
function startPairing() {
    if (isPairing) return;
    isPairing = true;
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question("Enter phone number with country code: ", async (number) => {
        try {
            console.log("⏳ Requesting pairing code...");
            const code = await sock.requestPairingCode(number);
            console.log("\n✅ PAIRING CODE:", code);
            console.log("\n📲 Open WhatsApp → Settings → Linked Devices → Link with phone number");
            console.log("➡️  Enter the code above within 30 seconds.\n");
        } catch (err) {
            console.error("❌ Pairing failed:", err.message);
            console.log("💡 Common fixes:");
            console.log("   - Enable a VPN (WhatsApp often blocks certain IPs)");
            console.log("   - Wait 2 minutes and try again");
            console.log("   - Restart Termux and run `node index.js`");
            // Retry after 15 seconds
            setTimeout(() => {
                isPairing = false;
                startBot();
            }, 15000);
        }
        rl.close();
        isPairing = false;
    });
}

console.log("🚀 Starting bot...");
startBot();
