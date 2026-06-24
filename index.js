const readline = require("readline");
const pino = require("pino");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

async function startBot() {

    const { state, saveCreds } =
        await useMultiFileAuthState("./session");

    // ----- SPEED: use a fixed stable version (avoid network fetch) -----
    // const { version } = await fetchLatestBaileysVersion(); // slow
    const version = [2, 3000, 1015906]; // known‑working, fast

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "error" }),         // less log = faster
        browser: ["Ubuntu", "Chrome", "20.0.04"],  // mimics real browser
        syncFullHistory: false,                   // don't download old messages
        markOnlineOnConnect: true,                // faster handshake
        connectTimeout: 30000,
        defaultQueryTimeoutMs: 30000
    });

    sock.ev.on("creds.update", saveCreds);

    if (!sock.authState.creds.registered) {

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(
            "Enter phone number with country code: ",
            async (number) => {

                try {
                    const code =
                        await sock.requestPairingCode(number);

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

    sock.ev.on("connection.update", ({ connection }) => {

        if (connection === "open") {
            console.log("✅ Bot connected.");
        }

        if (connection === "close") {
            console.log("❌ Disconnected.");
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

            // ----- SPEED: send presence & reaction without waiting -----
            sock.sendPresenceUpdate("composing", jid).catch(() => {});
            sock.sendMessage(jid, {
                react: {
                    text: "⚡",
                    key: msg.key
                }
            }).catch(() => {});

            // ----- Process commands (unchanged) -----
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
                await sock.sendMessage(jid, {
                    text: "Pong ⚡"
                });
            }

            if (
                text === ".away" ||
                text === ".owner" ||
                text.toLowerCase().includes("veldrix")
            ) {
                await sock.sendMessage(jid, {
                    text: "Veldrix is not online."
                });
            }

        } catch (e) {
            console.log(e);
        }
    });
}

startBot();
