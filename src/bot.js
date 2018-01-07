const Bot = require('./lib/Bot');
const SOFA = require('sofa-js');
const Fiat = require('./lib/Fiat');
const PsqlStore = require('./PsqlStore');
const IdService = require('./lib/IdService');
const Logger = require('./lib/Logger');
const unit = require('ethjs-unit');

let _bot = new Bot();

// CONTROLS

const FAQ = {
  'faq:about': {
    label: 'About',
    message: `This bot is a list of bots on Toshi. Maintained by users like you, for users like you.\nTo make the list as complete as possible, please add the bots you find! \ud83d\ude4b` // :raised_hand:
  },
  'faq:payment': {
    label: "Donations",
    message: `Feel free to send any amount to this bot as a donation. 🙏` // :folded_hands:
  },
  'faq:who': {
    label: "Who made this bot?",
    message: "@" + _bot.client.config.authorUsername + "\nFeedback and suggestions \ud83d\udca1 welcome!" // :light_bulb:
  }
};

const FAQ_MENU = {
  type: "group",
  label: "FAQ",
  controls: Object.keys(FAQ).map((value) => {
    let option = FAQ[value];
    return {type: "button", label: option.label, value: value};
  })
};

const DEFAULT_CONTROLS = [
    {type: 'button', label: 'Show all bots', value: 'show all bots'},
    {type: 'button', label: 'Add a bot', value: 'add a bot'},
    FAQ_MENU    
];


// DATABASE

const DATABASE_TABLES = `
CREATE TABLE IF NOT EXISTS registered_bots (
    toshi_id VARCHAR PRIMARY KEY,
    username VARCHAR UNIQUE,
    entry_created_on TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'),
	entry_created_by VARCHAR,
    entry_modified_on TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'),
	entry_modified_by VARCHAR,
    is_online BOOLEAN DEFAULT TRUE,
  is_working_properly BOOLEAN DEFAULT TRUE,
  reputation_score decimal NULL,
  average_rating decimal NULL,
  review_count decimal NULL
);
ALTER TABLE registered_bots DROP COLUMN IF EXISTS reputation_score;
ALTER TABLE registered_bots DROP COLUMN IF EXISTS average_rating;
ALTER TABLE registered_bots DROP COLUMN IF EXISTS review_count;

ALTER TABLE registered_bots ADD COLUMN IF NOT EXISTS reputation_score decimal NULL;
ALTER TABLE registered_bots ADD COLUMN IF NOT EXISTS average_rating decimal NULL;
ALTER TABLE registered_bots ADD COLUMN IF NOT EXISTS review_count decimal NULL;
`;
//TODO remove the drop columns
_bot.onReady = () => {
  _bot.dbStore = new PsqlStore(_bot.client.config.storage.postgres.url, process.env.STAGE || 'development');
  _bot.dbStore.initialize(DATABASE_TABLES).then(() => {}).catch((err) => {
    Logger.error(err);
  });
};

// ROUTING

_bot.onEvent = function(session, message) {

  if (session.user.is_app) {
    return;  //Prevent spamming from other bots
  }

  switch (message.type) {
    case 'Init':
      welcome(session);
      break;
    case 'Message':
      onMessage(session, message);
      break;
    case 'Command':
      onCommand(session, message);
      break;
    case 'Payment':
      onPayment(session, message);
      break;
    case 'PaymentRequest':
      welcome(session);
      break;
  }
};

function onMessage(session, message) {

  if(message.body.startsWith("@"))
    tryAddNewBot(session, message);
  else if(message.body === 'test'){ //TODO: remove
    _bot.dbStore.fetch("SELECT toshi_id FROM registered_bots").then((bots) => {
      var token_ids = bots.map(bot => bot.toshi_id);

      IdService.getUsers(token_ids).then((botsFound) => {

        if(botsFound){ 
          Logger.info(Object.getOwnPropertyNames(botsFound));
          let msgBody = botsFound[0].username;
          sendMessageWithinSession(session, msgBody);      
        }
        else{
            sendMessageWithinSession(session, "Bots not found");
        }
      }).catch((err) => Logger.error(err));

      
    }).catch((err) => {
      Logger.error(err);
    });
  } 
  else 
    welcome(session);
};


function onCommand(session, command) {
  switch (command.content.value) {
    case 'show all bots':
      displayAllBots(session);
      break;
    case 'add a bot':
      displayAddBotInstructions(session);
      break;
    default:
      if (command.value in FAQ) {  
        let msgBody = FAQ[command.value].message
        sendMessageWithinSession(session, msgBody);
      }
    }  
};

function onPayment(session, message) {
  if (message.fromAddress == session.config.paymentAddress) {
    // handle payments sent by the bot
    if (message.status == 'confirmed') {
      // perform special action once the payment has been confirmed
      // on the network
    } else if (message.status == 'error') {
      // oops, something went wrong with a payment we tried to send!
    }
  } else {
    // handle payments sent to the bot
    if (message.status == 'unconfirmed') {
      // payment has been sent to the ethereum network, but is not yet confirmed
      sendMessageWithinSession(session, `Your payment has been sent.\nYou will be notified when it is confirmed.`);
      
    } else if (message.status == 'confirmed') {
      sendMessageWithinSession(session, `Your payment was confirmed.\nThanks for the donation! 🙏`);
      sendNotificationToAuthor("Hi owner,\n" + session.user.username + " made a donation for " 
        + unit.fromWei(message.value, 'ether') + " ETH to address: " + message.toAddress);
    } else if (message.status == 'error') {
      sendMessageWithinSession(session, `There was an error with your payment!🚫`);
    }
  }
}

// STATES

function welcome(session) {
  sendMessageWithinSession(session, `Welcome to Bots! A user maintained list of the bots on Toshi.`);
};

function displayAllBots(session) {
  _bot.dbStore.fetch("SELECT username, entry_created_on, reputation_score FROM registered_bots").then((bots) => {

    let msgBody = (bots && bots.length > 0) ? ("Here is the list of all registered bots:\n" + prettyPrintList(bots)) : "No bot listed yet. Maybe add one?";

    sendMessageWithinSession(session, msgBody);
  }).catch((err) => {
    Logger.error(err);
  });
};

function prettyPrintList(bots){
  return bots.map(bot => "@" + bot.username + getFlags(bot)).sort().join("\n");
}

function getFlags(bot){  
  flag_separator = '   ';
  flags = '';
  flags = flags + flag_separator + bot.reputation_score;

  show_new_for_days = 7;
  if(isBotNew(bot))
    flags = flags + flag_separator + '\ud83c\udd95';   //Word "NEW" in a blue square
  
  return flags;
}

function isBotNew(bot){
  show_new_for_days = 7;
  return (Date.parse(bot.entry_created_on) > Date.now() - (1000 * 60 * 60 * 24 * show_new_for_days));
}

function displayAddBotInstructions(session) {
  let msgBody = 'Add a bot anytime by typing its username, starting with "@" (example: @ToshiBot).';

  session.reply(SOFA.Message({
    body: msgBody,
    controls: null,
    showKeyboard: true,
  }));
};

//TODO: Handle the case where a user wants to add a bot that already exists in the db by username,
//but with a different toshi_ID. In this case we need to try to add the old bot again - thus mapping it
//to its new toshi_id if it exists. And then we need to assign the new username to the toshi_id already in the
//DB. Finally, we need to display a message to the user explaining what happened (the level of detail is yet
//to be defined)
function tryAddNewBot(session, message){

  let botUserName = message.body.trim().replace("@", "");
  let atBotUserName = "@" + botUserName ;

  IdService.getUser(botUserName).then((botFound) => {

    if(botFound){ 
      if(botFound.is_app){
        fetchResigsteredBotByToshiId(botFound.toshi_id).then((sameBotAlreadyInList) => {
         
          if(sameBotAlreadyInList)
            sendMessageWithinSession(session, atBotUserName + " is already in the list.");
          else
            insertNewBot(session, botFound);
        });      
      }   
      else 
        sendMessageWithinSession(session, atBotUserName + " is human!");
    }
    else{
        sendMessageWithinSession(session, atBotUserName + " does not exist.");
    }
  }).catch((err) => Logger.error(err));
};


function insertNewBot(session, newBot)
{
  _bot.dbStore.execute("INSERT INTO registered_bots (toshi_id, username, entry_created_by, entry_modified_by, reputation_score, average_rating, review_count) VALUES ($1, $2, $3, $3, $4, $5, $6) ", 
  [newBot.toshi_id, newBot.username, session.user.toshi_id, newBot.reputation_score, newBot.average_rating, newBot.review_count])
  .then(() => {

    sendMessageWithinSession(session, "@" + newBot.username + " was added to the list.")
  }).catch((err) => {
    Logger.error(err);
  });
};

function fetchResigsteredBotByToshiId(bot_toshi_id)
{
  return _bot.dbStore.fetchrow("SELECT * FROM registered_bots where toshi_id = $1", [bot_toshi_id])
    .then((botFound) => {
    return botFound;
  }).catch((err) => Logger.error(err));
};


// HELPERS

function sendMessageWithinSession(session, msgBody) {
  session.reply(SOFA.Message({
    body: msgBody,
    controls: DEFAULT_CONTROLS,
    showKeyboard: false,
  }));
};

function sendNotificationToAuthor(msgBody) {
  sendNotificationToUsername(_bot.client.config.authorUsername, msgBody);
}

function sendNotificationToUsername(username, msgBody) {
  IdService.getUser(username).then((userFound) => {
    sendNotificationToAddress(userFound.toshi_id, msgBody);
  }).catch((err) => Logger.error(err)); 
}


function sendNotificationToAddress(toshiId, msgBody) {
  if (!toshiId || toshiId === "") {
    Logger.error("Cannot send messages to empty, null or undefined toshiId");
    return;
  }
  _bot.client.send(toshiId, msgBody);
}
