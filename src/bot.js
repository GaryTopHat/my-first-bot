const Bot = require('./lib/Bot');
const SOFA = require('sofa-js');
const Fiat = require('./lib/Fiat');
const PsqlStore = require('./PsqlStore');
const IdService = require('./lib/IdService');
const Logger = require('./lib/Logger');
const unit = require('ethjs-unit');

let _bot = new Bot();
var _lastDataUpdateDate;
// CONTROLS

const FAQ = {
  'faq:about': {
    label: 'About',
    message: `This bot is a list of bots on Toshi. Maintained by users like you, for users like you.\nTo make the list as complete as possible, please add the bots you find! \ud83d\ude4b` // :raised_hand:
  },
  'faq:weather': {
    label: 'What do the weather icons mean?',
    message: `The weather icons give a quick idea of each bot's reputation score calculated by Toshi based on average rating, and number of ratings.`
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
    review_count decimal NULL,
    is_visible_on_list BOOLEAN DEFAULT TRUE
);

ALTER TABLE registered_bots ADD COLUMN IF NOT EXISTS reputation_score decimal NULL;
ALTER TABLE registered_bots ADD COLUMN IF NOT EXISTS average_rating decimal NULL;
ALTER TABLE registered_bots ADD COLUMN IF NOT EXISTS review_count decimal NULL;
ALTER TABLE registered_bots ADD COLUMN IF NOT EXISTS is_visible_on_list BOOLEAN DEFAULT TRUE;
`;

_bot.onReady = () => {
  _lastDataUpdateDate = Date.now();
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

  var dataRefreshIntervalHours = 24;
  var now = Date.now();
  if(!_lastDataUpdateDate || now - _lastDataUpdateDate > (1000 * 60 * 60 *  dataRefreshIntervalHours)){
    updateResgisteredBotsData(session);
    _lastDataUpdateDate = now;
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

  if(_bot.client.config.authorUsername === session.user.username)
  {
    if(message.body === "ForceRepUpdate"){
      updateResgisteredBotsData(session);
      _lastDataUpdateDate = Date.now();
    }
    else if(message.body === "LastRepUpdate")
      sendMessageWithinSession(session, new Date(_lastDataUpdateDate).toUTCString());
    else if(message.body.startsWith("Delete @"))
      deleteBotByUsername(session, message.body.split("@")[1]);
    else if(message.body.startsWith("Hide @"))
      updateBotVisibilityByUsername(session, message.body.split("@")[1], false);
    else if(message.body.startsWith("Unhide @"))
      updateBotVisibilityByUsername(session, message.body.split("@")[1], true);
  }
  if(message.body.startsWith("@"))
    tryAddNewBot(session, message); 
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
  _bot.dbStore.fetch("SELECT username, entry_created_on, reputation_score FROM registered_bots WHERE is_visible_on_list=TRUE").then((bots) => {

    let msgBody = (bots && bots.length > 0) ? (prettyPrintList(bots)) : "No bot listed yet. Maybe add one?";

    sendMessageWithinSession(session, msgBody);
  }).catch((err) => {
    Logger.error(err);
  });
};

function prettyPrintList(bots){
  var separator = '\t';
  return  bots.sort((a,b) => a.reputation_score - b.reputation_score).map(bot => getBotInfo(bot, separator)).join("\n");
}

function getBotInfo(bot, separator){  
  botInfo = prettyPrintRating(bot.reputation_score) + separator + "@" + bot.username;
  
  if(isBotNew(bot))
  botInfo = botInfo + separator + '\ud83c\udd95';   //Word "NEW" in a blue square
  
  return botInfo;
}

function prettyPrintRating(score)
{
  if(score === null)
    return "?";
  else if(score >= 4.5)
    return '\ud83d\udd25'; //Fire
  else if (score >= 3.5)
    return '\u2600'; //Sun with rays
  else if (score >= 2.5)
    return '\uD83C\uDF24'; //Sun behind small cloud 
  /* else if (score >= 2)
    return '\u26c5'; //Sun behind large cloud */
  else if (score >= 1.5)
    return '\u2601'; //Cloud
  else if (score >= 0)
    return '\u2614'; //Umbrella with rain drops 

  return '';
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
         
          if(sameBotAlreadyInList){
            if(sameBotAlreadyInList.is_visible_on_list)
              sendMessageWithinSession(session, atBotUserName + " is already in the list.");
            else
            sendMessageWithinSession(session, "The owner of " + atBotUserName + " asked for it to not appear in the list.");
          }
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

function updateBotReputation(session, bot)
{
  _bot.dbStore.execute("UPDATE registered_bots SET entry_modified_by=$1, entry_modified_on=$2, reputation_score=$3, average_rating=$4, review_count=$5 WHERE toshi_id=$6", 
  [session.user.toshi_id, new Date(), bot.reputation_score, bot.average_rating, bot.review_count, bot.toshi_id,])
  .then(() => {

    Logger.info("Successfuly updated @" + bot.username);
  }).catch((err) => {
    Logger.error(err);
  });
};

function updateBotVisibilityByUsername(session, username, isVisible)
{
  _bot.dbStore.execute("UPDATE registered_bots SET entry_modified_by=$1, entry_modified_on=$2, is_visible_on_list=$3 WHERE username=$4", 
  [session.user.toshi_id, new Date(), isVisible, username,])
  .then(() => {

    sendMessageWithinSession(session, "@" + username + " visibility set to " + isVisible);
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

function deleteBotByUsername(session, username)
{
  _bot.dbStore.execute("DELETE FROM registered_bots WHERE username=$1 ", 
  [username])
  .then(() => {

    sendMessageWithinSession(session, "@" + username + " was removed from the list.");
  }).catch((err) => {
    Logger.error(err);
  });
}

function updateResgisteredBotsData(session){
  _bot.dbStore.fetch("SELECT toshi_id, username FROM registered_bots").then((registeredBots) => {
    var registered_toshi_ids = registeredBots.map(bot => bot.toshi_id);

    IdService.getUsers(registered_toshi_ids).then((botsFound) => {

      if(botsFound){ 
        botsFound.results.filter(bot => registered_toshi_ids.indexOf(bot.toshi_id) > -1).map(bot => updateBotReputation(session, bot));
          
      }
      else{
          Logger.info(session, "No bot found to update");
      }
    }).catch((err) => Logger.error(err));

    
  }).catch((err) => {
    Logger.error(err);
  });
}
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
