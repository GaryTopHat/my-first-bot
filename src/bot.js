const Bot = require('./lib/Bot')
const SOFA = require('sofa-js')
const Fiat = require('./lib/Fiat')
const PsqlStore = require('./PsqlStore')
const IdService = require('./lib/IdService')
const Logger = require('./lib/Logger');

let bot = new Bot()

const DATABASE_TABLES = `
CREATE TABLE IF NOT EXISTS registered_bots (
    toshi_id VARCHAR PRIMARY KEY,
    entry_created_on TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'),
	entry_created_by VARCHAR PRIMARY KEY,
    entry_modified_on TIMESTAMP WITHOUT TIME ZONE DEFAULT (now() AT TIME ZONE 'utc'),
	entry_modified_by VARCHAR PRIMARY KEY,
    is_online BOOLEAN DEFAULT TRUE,
	is_working_properly BOOLEAN DEFAULT TRUE
);
`;

// ROUTING

bot.onEvent = function(session, message) {
  switch (message.type) {
    case 'Init':
      welcome(session)
      break
    case 'Message':
      onMessage(session, message)
      break
    case 'Command':
      onCommand(session, message)
      break
    case 'Payment':
      onPayment(session, message)
      break
    case 'PaymentRequest':
      welcome(session)
      break
  }
}

function onMessage(session, message) {

  if(session.get('expected_user_input_type') === "bot_username")
    tryAddNewBot(session, message)
  else 
    welcome(session)
}


function onCommand(session, command) {
  switch (command.content.value) {
    case 'show all bots':
      dislayAllBots(session)
      break
    case 'add a bot': //TODO remove: count
      displayAddBotInstructions(session)
      break
    case 'donate':
      donate(session)
      break
    }
}

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

bot.onReady = () => {
  bot.dbStore = new PsqlStore(bot.client.config.storage.postgres.url, process.env.STAGE || 'development');
  bot.dbStore.initialize(DATABASE_TABLES).then(() => {}).catch((err) => {
    Logger.error(err);
  });
};

const DEFAULT_CONTROLS = [
	{type: 'button', label: 'Show all bots', value: 'show all bots'},
    {type: 'button', label: 'Add a bot', value: 'add a bot'},
    {type: 'button', label: 'Donate', value: 'donate'}
];


// STATES

function welcome(session) {
  sendMessage(session, `Welcome to MoreBots! A user maintained list of bots on Toshi`)
}

function dislayAllBots(session) {
  bot.dbStore.fetchval("SELECT toshi_id FROM registered_bots").then((bots) => {
    // :bulb:
    let msg = `\uD83D\uDCA1 Here is the list of all registered bots: ${bots}`;
    sendMessage(session, msg);
  }).catch((err) => {
    Logger.error(err);
  });
}

function displayAddBotInstructions(session) {
  session.set('expected_user_input_type', "bot_username")
  let msg = "Type the username of the bot you want to add (Make sure to uer the username and not the display name)."

  session.reply(SOFA.Message({
    body: msg,
    controls: null,
    showKeyboard: true,
  }))
}

function tryAddNewBot(session, message){
  session.set('expected_user_input_type', null)
   
  let botUserName = message.body.trim().replace("@", "")
  let atBotUserName = "@" + botUserName 

  IdService.getUser(botUserName).then((userFound) => {
    let bot = userFound
  }).catch((err) => Logger.error(err))

  Logger.debug("Log start")
  Logger.debug(bot.hasOwnProperty("errors"))
  Logger.debug("Log end")
  //let bot = IdService.getUser(botUserName)

  if(!bot.hasOwnProperty("errors")){ 
    if(bot.is_app){
      sendMessage(session, atBotUserName + " was added to the list.")
    }   
    else 
      sendMessage(session, atBotUserName + " is human!")
  }
  else{
    if(bot.errors.id === "not_found")
      sendMessage(session, atBotUserName + " does not exist.")
    else 
      sendMessage(session,  + "An error occurred while trying to find" + atBotUserName + ".")
  }
}

function fethResigsteredBotByToshiId(bot_toshi_id)
{
  bot.dbStore.fetchrow("SELECT * FROM registered_bots where toshi_id = $1", [bot_toshi_id])
    .then((bot) => {
    return bot
  }).catch((err) => Logger.error(err));
}

function donate(session) {
  // request $1 USD at current exchange rates
  Fiat.fetch().then((toEth) => {
    session.requestEth(toEth.USD(1))
  })
}

// HELPERS

function sendMessage(session, message) {
  let controls =  DEFAULT_CONTROLS
  session.reply(SOFA.Message({
    body: message,
    controls: controls,
    showKeyboard: false,
  }))
}
