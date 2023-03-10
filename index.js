// Require the necessary discord.js classes
const fs = require("node:fs");
const path = require("node:path");
const https = require("https");
const querystring = require("querystring");
const { Client, Collection, Events, GatewayIntentBits } = require("discord.js");
const {
  token,
  botUsername,
  botPassword,
  twitchClientId,
  twitchClientSecret,
  twitchRefreshToken,
  streamers,
} = require("./config.json");
const tmi = require("tmi.js");
const file = require("./config.json");
const { exit } = require("node:process");

// Create a new client instance
const client = new Client({
  intents: [],
});

// Initialize the discord event files --------------------------------------------
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const event = require(filePath);
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}
// -----------------------------------------------------------------------

// Initialize commands ---------------------------------------------------
client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  // Set a new item in the Collection with the key as the command name and the value as the exported module
  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  } else {
    console.log(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
    );
  }
}
// -----------------------------------------------------------------------

// Simple delay function
function delay(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

// Check if the access token is valid, if not, create a new one
// Mainly just a GET request to https://id.twitch.tv/oauth2/validate to check if the token is valid
// If it is not, sends a POST request to https://id.twitch.tv/oauth2/token to get a new access token
function checkTwitchToken() {
  return new Promise((resolve, reject) => {
    // Replace YOUR_ACCESS_TOKEN with the actual access token
    const access_token = botPassword;

    const getOptions = {
      hostname: "id.twitch.tv",
      path: "/oauth2/validate",
      headers: {
        Authorization: "OAuth " + access_token,
        "Client-ID": twitchClientId,
      },
    };

    https
      .get(getOptions, async (response) => {
        const { statusCode } = response;
        const contentType = response.headers["content-type"];

        let error;
        if (statusCode !== 200) {
          error = new Error("Request Failed.\n" + `Status Code: ${statusCode}`);
          console.log("There was an error... Creating a new access token...");
          // Create a post request to get a new access token
          const client_id = twitchClientId;
          const client_secret = twitchClientSecret;
          const refresh_token = twitchRefreshToken;

          const data = querystring.stringify({
            client_id: client_id,
            client_secret: client_secret,
            grant_type: "refresh_token",
            refresh_token: refresh_token,
          });

          const options = {
            hostname: "id.twitch.tv",
            path: "/oauth2/token",
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Content-Length": data.length,
            },
          };

          const req = https.request(options, (res) => {
            const { statusCode } = res;
            const contentType = res.headers["content-type"];

            let error;
            if (statusCode !== 200) {
              error = new Error(
                "Request Failed.\n" + `Status Code: ${statusCode}`
              );
            }

            // Prints POST response to console and writes new codes to config.json
            res.setEncoding("utf8");
            let rawData = "";
            res.on("data", (chunk) => {
              rawData += chunk;
            });
            res.on("end", () => {
              try {
                const parsedData = JSON.parse(rawData);
                console.log(parsedData);
                file.botPassword = parsedData.access_token;
                file.twitchRefreshToken = parsedData.refresh_token;
                const fileName = "./config.json";

                fs.writeFile(
                  fileName,
                  JSON.stringify(file),
                  function writeJSON(err) {
                    if (err) return console.log(err);
                    console.log(JSON.stringify(file, null, 2));
                    console.log("writing to " + fileName);
                  }
                );
                resolve(parsedData.access_token);
              } catch (e) {
                console.error(e.message);
              }
            });
          });

          req.on("error", (e) => {
            console.error(`Got error: ${e.message}`);
          });

          req.write(data);
          req.end();
        } else {
          resolve(access_token);
        }

        // Prints GET response to console
        response.setEncoding("utf8");
        let rawData = "";
        response.on("data", (chunk) => {
          rawData += chunk;
        });
        response.on("end", () => {
          try {
            const parsedData = JSON.parse(rawData);
            console.log(parsedData);
          } catch (e) {
            console.error(e.message);
          }
        });
      })
      .on("error", (e) => {
        console.error(`Got error: ${e.message}`);
      });
  });
}

const init = async () => {
  const access_token = await checkTwitchToken();

  const opts = {
    identity: {
      username: botUsername,
      password: access_token,
    },
    channels: streamers,
    reconnectInterval: 5000,
  };

  const twitchClient = new tmi.client(opts);

  // Define configuration options for the Twitch client

  console.log("Connecting to Twitch...");

  // Create a client with our options

  // When the twitch client connects, log the address and port to the console
  twitchClient.on("connected", (address, port) => {
    console.log(`* Connected to ${address}:${port}`);
  });

  twitchClient
    .connect()
    .then(() => {
      console.log("Connected to Twitch!");
    })
    .catch((err) => {
      console.log("Error connecting to Twitch: " + err);
    });

  // Ping the Twitch server every 5 minutes to avoid being disconnected
  setInterval(() => {
    twitchClient
      .ping()
      .then((data) => {
        // console.log("Ping: " + data);
      })
      .catch((err) => {
        console.log("Error: " + err);
        exit(0);
      });
  }, 60000);
  // attach the twitch client to the discord client so I can access it in command files
  client.twitchClient = twitchClient;

  // Log in to Discord with your client's token
  client.login(token);
};

init();
