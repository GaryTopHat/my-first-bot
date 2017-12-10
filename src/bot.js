const Bot = require('./lib/Bot');
const SOFA = require('sofa-js');
const Fiat = require('./lib/Fiat');
const PsqlStore = require('./PsqlStore');
const IdService = require('./lib/IdService');
const Logger = require('./lib/Logger');

let _bot = new Bot();

const DATABASE_TABLES = `
CREATE TABLE IF NOT EXISTS registered_bots (
    toshi_id VARCHAR PRIMARY KEY,
    username VARCHAR UNIQUE,
    entry_created_on TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'),
	entry_created_by VARCHAR,
    entry_modified_on TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'),
	entry_modified_by VARCHAR,
    is_online BOOLEAN DEFAULT TRUE,
	is_working_properly BOOLEAN DEFAULT TRUE
);
`;

_bot.onReady = () => {
  _bot.dbStore = new PsqlStore(_bot.client.config.storage.postgres.url, process.env.STAGE || 'development');
  _bot.dbStore.initialize(DATABASE_TABLES).then(() => {}).catch((err) => {
    Logger.error(err);
  });
};

// ROUTING

_bot.onEvent = function(session, message) {
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

  if(session.get('expected_user_input_type') === "bot_username")
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
    case 'donate':
      donate(session);
      break;
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
      sendMessage(session, `Thanks for the payment! 🙏`);
    } else if (message.status == 'confirmed') {
      // handle when the payment is actually confirmed!
    } else if (message.status == 'error') {
      sendMessage(session, `There was an error with your payment!🚫`);
    }
  }
}

// STATES

function welcome(session) {
  sendMessage(session, `Welcome to MoreBots! A user maintained list of bots on Toshi`);
};

function displayAllBots(session) {
  _bot.dbStore.fetch("SELECT username FROM registered_bots").then((bots) => {
    // :bulb:
    let msg = bots ? "Here is the list of all registered bots:\n" + prettyPrintList(bots) : "The list is empty.";

    sendMessage(session, msg);
  }).catch((err) => {
    Logger.error(err);
  });
};

function prettyPrintList(bots){
  return bots.map(bot => Object.getOwnPropertyNames(bot)).join("\n");
}

function displayAddBotInstructions(session) {
  session.set('expected_user_input_type', "bot_username");
  let msg = "Type the username of the bot you want to add (Make sure to use the username and not the display name).";

  session.reply(SOFA.Message({
    body: msg,
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
  session.set('expected_user_input_type', null);
   
  let botUserName = message.body.trim().replace("@", "");
  let atBotUserName = "@" + botUserName ;

  IdService.getUser(botUserName).then((botFound) => {

    if(botFound){ 
      if(botFound.is_app){
        fetchResigsteredBotByToshiId(botFound.toshi_id).then((sameBotAlreadyInList) => {
         
          if(sameBotAlreadyInList)
            sendMessage(session, atBotUserName + " is already in the list.");
          else
            insertNewBot(session, botFound);
        });      
      }   
      else 
        sendMessage(session, atBotUserName + " is human!");
    }
    else{
        sendMessage(session, atBotUserName + " does not exist.");
    }
  }).catch((err) => Logger.error(err));
};

function insertNewBot(session, newBot)
{
  _bot.dbStore.execute("INSERT INTO registered_bots (toshi_id, username, entry_created_by, entry_modified_by) VALUES ($1, $2, $3, $3) ", [newBot.toshi_id, newBot.username, session.user.toshi_id])
  .then(() => {

    sendMessage(session, "@" + newBot.username + " was added to the list.")
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

function donate(session) {
  // request $1 USD at current exchange rates
  Fiat.fetch().then((toEth) => {
    session.requestEth(toEth.USD(1));
  });
};

// HELPERS

function sendMessage(session, message) {
  let controls =  [
    {type: 'button', label: 'Show all bots', value: 'show all bots'},
      {type: 'button', label: 'Add a bot', value: 'add a bot'},
      {type: 'button', label: 'Donate', value: 'donate'}
  ];
  session.reply(SOFA.Message({
    body: message,
    controls: controls,
    showKeyboard: false,
  }));
};
