const TelegramBot = require('node-telegram-bot-api')
const Datastore = require('nedb')
const request = require('request')

const db = new Datastore({ filename: 'store.db', autoload: true })

const { TELEGRAM_BOT_API_TOKEN, GOOGLE_API_TOKEN, JWT_SECRET } = require('./config.json')

const bot = new TelegramBot(TELEGRAM_BOT_API_TOKEN, { polling: true })

/**
 *  Listener for the message event.
 */
bot.on('message', (msg) => {

    if (msg.text.match(/\/start/)) {
        var msgElements = msg.text.split(' ')
        var event = {}

        /** If hashed message info exists,
         * update the event's chatId and start getting answers.
        */
        if (msgElements[1]) {
            var token = msgElements[1]
            db.remove({ _chatId: msg.chat.id, active: true }, { multi: true }, () => {
                db.update({ _id: token }, { $set: { _chatId: msg.chat.id } }, { returnUpdatedDocs: true }, (err, numAffected, affectedDoc) => {
                    if (affectedDoc) {
                        generateEvent(affectedDoc, msg)
                    }
                })
            })
        } else {
            bot.sendMessage(msg.chat.id, `Let's start, send me the meeting title !`)
            event = {
                _chatId: msg.chat.id,
                active: true,
                readyToPublished: false,
                positive: [],
                neutral: [],
                negative: []
            }
            db.remove({ _chatId: msg.chat.id, active: true }, { multi: true }, () => {
                db.insert(event, (err, newDoc) => {
                    if (err) throw err
                })
            })
        }
    } else if (msg.text.match(/\/events/)) {
        db.findOne({ _chatId: msg.chat.id, active: true, readyToPublished: true }, (err, doc) => {
            if (doc) {
                generateEvent(doc, msg)
            } else {
                bot.sendMessage(msg.chat.id, `Can't find any active events. Send /start to create a new one.`)
            }
        })
    } else if(msg.text.match(/\/results/)) {

        if (msg.chat.type === 'group') {
            db.findOne({ _chatId: msg.chat.id, active: true, readyToPublished: true }, (err, doc) => {
                if (doc) {
                    generateVoteResults(doc, msg)
                } else {
                    bot.sendMessage(msg.chat.id, `Can't find any active events. Send /start to create a new one.`)
                }
            })
        } else {
            bot.sendMessage(msg.chat.id, 'Event has to be started in group to see the results...')
        }

    } else if((msg.text === 'I\'m going !' || msg.text === 'No' || msg.text === 'Maybe') && msg.chat.type === 'group') {
        console.log('****MSG*****', msg)
        
        if (msg.text === 'I\'m going !') {
            db.update({ _chatId: msg.chat.id }, { $addToSet: { positive: msg.from.id } }, { returnUpdatedDocs: true }, (err, numAffected, affectedDoc) => {
                if (affectedDoc) {
                    generateVoteResults(affectedDoc, msg)
                }
            })
        } else if (msg.text === 'No') {
            db.update({ _chatId: msg.chat.id }, { $addToSet: { negative: msg.from.id } }, { returnUpdatedDocs: true }, (err, numAffected, affectedDoc) => {
                if (affectedDoc) {
                    generateVoteResults(affectedDoc, msg)
                }
            })
        } else {
            db.update({ _chatId: msg.chat.id }, { $addToSet: { neutral: msg.from.id } }, { returnUpdatedDocs: true }, (err, numAffected, affectedDoc) => {
                if (affectedDoc) {
                    generateVoteResults(affectedDoc, msg)
                }
            })
        }

        db.update({ _chatId: msg.chat.id }, { $inc: { update: 1 } }, { returnUpdatedDocs: true }, (err, numAffected, affectedDoc) => {
            if (affectedDoc) {
                generateEvent(affectedDoc, msg)
            }
        })
    }
    else {
        db.findOne({ _chatId: msg.chat.id, active: true }, (err, doc) => {
            if (doc && doc.active) {
                if (!doc.title) {
                    bot.sendMessage(msg.chat.id, `Great,now send me the *date* or *time* for ${msg.text} meeting.`, { parse_mode: "Markdown" })
                    db.update({ _chatId: msg.chat.id, active: true }, { $set: { title: msg.text } }, { returnUpdatedDocs: true })
                } else if (!doc.date) {
                    bot.sendMessage(msg.chat.id, `Send me the *location* for the meeting.`, { parse_mode: "Markdown" })
                    db.update({ _chatId: msg.chat.id, active: true }, { $set: { date: msg.text } }, { returnUpdatedDocs: true })
                } else if (!doc.location) {
                    bot.sendMessage(msg.chat.id, `Event ready !`)
                    geocodeRequest(msg.text, (err, location) => {
                        if (err) {
                            location = {
                                address: msg.text
                            }
                        }
                        db.update({ _chatId: msg.chat.id, active: true }, { $set: { location, readyToPublished: true } }, { returnUpdatedDocs: true }, (err, numAffected, affectedDoc) => {
                            if (!err) generateEvent(affectedDoc, msg)
                        })
                    })
                }
            }
        })
    }
})

/**
 * 
 * @param {*} msgChatId 
 * A unique chat identifier
 * 
 * Generates a message that contains information about meeting
 * which is ready to be published.
 * 
 */
function generateEvent(doc, msg) {
    var message = '', reply_markup

    if (msg.chat.type === 'private') {
        message += 'Event created. Use this link to share it to a group:\n'
        message += `http://t.me/meetingsetterbot?startgroup=${doc._id}\n\n`
    } else {
        reply_markup = {
            "keyboard": [['I\'m going !'], ['Maybe'], ['No']]
        }
    }

    message += `*${doc.title}* \n\n \uD83D\uDCC5  ${doc.date} \n\n Adress: ${doc.location.address} \n\n Going: ${doc.positive} \n Maybe: ${doc.neutral} \n No: ${doc.negative}`
    bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown", reply_markup })
    if (doc.location.lat) {
        bot.sendLocation(msg.chat.id, doc.location.lat, doc.location.lng)
    }
}

function generateVoteResults(doc, msg) {

    var message = `COMING: ${doc.positive.length}\n MAYBE: ${doc.neutral.length} \n NOT COMING: ${doc.negative.length}\n\n`

    if (doc.positive.length > 0) {
        message += 'WHO IS COMING ? \n'
        doc.positive.forEach((el, index) => {
            bot.getChatMember(msg.chat.id, el)
                .then((chatMember) => {
                    message += `@${chatMember.user.username}, `
                    bot.sendMessage(msg.chat.id, message)
                })
        })
    }

}

/**
 * @param {*} address 
 * An adress string.
 * @param {*} callback 
 * Callback function either called with the location object or error.
 * 
 * Makes a geocode request to Google API to get the latitude and longtitude
 * values of the location with the given adress.
 * 
 * */
function geocodeRequest(address, callback) {

    var encodedAddress = encodeURIComponent(address)

    request({
        url: `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_API_TOKEN}`,
        json: true
    }, (error, response, body) => {
        if (error) {
            callback('Unable to connect Google servers...')
        } else if (body.status === 'ZERO_RESULTS') {
            callback('Unable to locate the address...')
        } else {
            callback(undefined, {
                address: body.results[0].formatted_address,
                lat: body.results[0].geometry.location.lat,
                lng: body.results[0].geometry.location.lng,
            })
        }
    })
}