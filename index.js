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

    // Try to fetch latest version, but fallback to a known stable one
    let version;
    try {
        const fetched = await fetchLatestBaileysVersion();
        version = fetched.version;
        console.log(`📡 Using fetched version: ${version.join('.')}`);
    } catch {
        version = [2, 3000, 1015906]; // stable version
        console.log(`📡 Using fallback version: ${version.join('.')}`);
    }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeout: 90000,
        defaultQueryTimeoutMs: 90000,
        syncFullHistory: false, // speeds up connection
        markOnlineOnConnect: true
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log("✅ Connection established.");
            if (!state.creds.registered && !isPairing) {
                setTimeout(startPairing, 2000);
            }
        }

        if (connection === "close") {
            if (isPairing) {
                console.log("⏳ Waiting for pairing input... (ignore disconnect)");
                return;
            }
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting in 8s...");
                setTimeout(startBot, 8000);
            } else {
                console.log("❌ Logged out. Delete session folder and restart.");
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
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
            console.log(e);
        }
    });

    if (state.creds.registered) {
        console.log("✅ Session found – waiting for connection...");
    }
}

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
            console.log("💡 Check your internet and try again.");
            setTimeout(() => {
                isPairing = false;
                startBot();
            }, 10000);
        }
        rl.close();
        isPairing = false;
    });
}

console.log("🚀 Starting bot...");
startBot();
