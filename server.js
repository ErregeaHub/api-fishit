// Import Libraries
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Set Port and Host Binding
const PORT = process.env.PORT || 8080;

// **********************************************
// ** PENTING: Health Check untuk Railway/Deployment **
// Route ini harus merespons cepat agar deployment lolos.
app.get("/", (req, res) => {
    res.status(200).send("Roblox Status API is LIVE and Healthy.");
});
// **********************************************

// Set HEADERS: Membuat header Cookie untuk otentikasi ke Roblox.
// Cookie yang dikirim oleh frontend HANYA berupa nilai token-nya saja.
const getHeaders = (cookie) => {
    // Memastikan cookie ada dan menyertakan awalan .ROBLOSECURITY=
    return cookie ? { 
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "Content-Type": "application/json" // Penting untuk POST requests ke Roblox
    } : {
        "Content-Type": "application/json"
    };
};

/**
 * Mengambil User ID untuk daftar username.
 */
async function getUserIds(usernames) {
    if (usernames.length === 0) return {};
    
    // ... (rest of getUserIds function remains the same)
    // [Kode getUserIds sama seperti sebelumnya]

    const chunks = [];
    for (let i = 0; i < usernames.length; i += 100) {
        chunks.push(usernames.slice(i, i + 100));
    }

    const userMap = {};
    for (const chunk of chunks) {
        try {
            const resp = await axios.post(
                "https://users.roblox.com/v1/usernames/users",
                { usernames: chunk },
                { headers: { "Content-Type": "application/json" } } // Tidak perlu cookie di sini
            );
            resp.data.data.forEach(user => {
                userMap[user.name.toLowerCase()] = user.id;
            });
        } catch (error) {
            console.error("Error fetching user IDs chunk:", error.message);
        }
    }
    return userMap;
}

/**
 * Mengambil nama game berdasarkan Place ID atau Universe ID.
 */
async function getGameInfo(id, cookie) {
    if (!id) return "Unknown Place";

    const headers = getHeaders(cookie);

    try {
        const resp = await axios.get(
            `https://games.roblox.com/v1/games/multiget-place-details?placeIds=${id}`,
            { headers }
        );
        const placeData = resp.data[0];
        return placeData?.name || "Unknown Place";
    } catch (err) {
        // Jika gagal, mungkin karena cookie tidak memiliki akses ke info game
        return "Unknown Place (Access Denied or Game Info Failed)";
    }
}

// *** ENDPOINT UTAMA ***
app.post("/api/status", async (req, res) => {
    // Cookie diambil dari header khusus 'x-roblox-cookie' yang dikirim oleh frontend
    const cookie = req.headers['x-roblox-cookie'];
    // Username diambil dari body request (req.body.users)
    const users = req.body.users;
    
    if (!users || users.length === 0) {
        return res.status(400).json({ error: "Daftar pengguna kosong." });
    }

    // 1. Get all User IDs first
    const uniqueUsers = [...new Set(users.map(u => u.trim()).filter(u => u))];
    const userMap = await getUserIds(uniqueUsers);
    
    // 2. Filter out usernames that couldn't be found and prepare for presence call
    const validUserIds = Object.values(userMap);
    
    // 3. Get Presence for all valid users in one API call
    const presenceBody = { userIds: validUserIds };
    let presenceData = { userPresences: [] };
    const headers = getHeaders(cookie); // Menggunakan cookie

    if (validUserIds.length > 0) {
        try {
             const resp = await axios.post("https://presence.roblox.com/v1/presence/users", presenceBody, { headers });
             presenceData = resp.data;
        } catch (e) {
             console.error("Presence API failed:", e.message);
             // JIKA error adalah 403 (Forbidden), kemungkinan cookie tidak valid
             if (e.response && e.response.status === 403) {
                 return res.status(403).json({ error: "Cookie Roblox tidak valid atau tidak memiliki izin akses." });
             }
             // Jika error lain, kirim error umum
             return res.status(500).json({ error: "Gagal memuat status dari Roblox." });
        }
    }
    
    // 4. Gather all results (Logic sama seperti sebelumnya)
    const results = [];
    
    const userIdToUsernameMap = Object.entries(userMap).reduce((acc, [username, id]) => {
        acc[id] = username;
        return acc;
    }, {});


    for (const username of uniqueUsers) {
        const userId = userMap[username.toLowerCase()];

        if (!userId) {
            results.push({ username, error: "Pengguna tidak ditemukan di Roblox." });
            continue;
        }

        const presence = presenceMap[userId];
        
        let mapName = "Offline";
        let status = "Offline";
        let placeId = null;
        let universeId = null;
        let lastLocation = "Offline";

        if (presence) {
             // ... (Logic penentuan status sama seperti sebelumnya)
             // [Kode penentuan status]
            placeId = presence.placeId;
            universeId = presence.universeId;
            lastLocation = presence.lastLocation;
            
            if (presence.userPresenceType === 3) { // In Game
                status = "In Game";
                mapName = await getGameInfo(presence.universeId || presence.placeId, cookie);
                if (!presence.placeId) {
                     mapName = "In Game (placeId hidden)";
                }

            } else if (presence.userPresenceType === 2) { // In Studio
                status = "In Game"; 
                mapName = "In Studio";
            }
            
            else if (presence.userPresenceType === 1) { // Online
                status = "Online";
                mapName = "Online di Website";
            }
        }

        results.push({
            username: userIdToUsernameMap[userId] || username, 
            userId, 
            status,
            placeId,
            universeId, 
            mapName,
            lastLocation,
        });
    }

    res.json(results);
});

// >>> START SERVER <<<
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Server running on port ${PORT} on host 0.0.0.0`));

module.exports = app;