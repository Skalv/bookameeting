const fs = require('fs')
const readline = require('readline')
const Buffer = require('buffer').Buffer
const btoa = require('btoa')
const atob = require('atob')
const _ = require('lodash')
const CronJob = require('cron').CronJob
const {google, docs_v1} = require('googleapis')
const {PubSub} = require('@google-cloud/pubsub');
const Datastore = require('nedb')
  , db = new Datastore({ filename: 'db/mails.db', autoload: true });

// If modifying these scopes, delete token.json.
const SCOPES = ['https://mail.google.com/', 'https://www.googleapis.com/auth/gmail.send']
const TOKEN_PATH = 'googleCreds/token.json'
const CREDENTIALS_PATH = 'googleCreds/credentials.json'


class GMail {
  constructor() {
    this.loadCredentials()

    this.watchJob = new CronJob('0 0 9 * * *', () => {
      this.watchMails()
    }, null, true, 'Europe/Paris');
    this.watchJob.start();
  }

  connectToGmailPubSub(projectId, topicName, subscriptionName, newMsgCB) {
    const pubsub = new PubSub({projectId})
    const topic = pubsub.topic(topicName)
    const sub = topic.subscription(subscriptionName)
  
    // Receive callbacks for new messages on the subscription
    sub.on('message', message => {
      this.newMessageHandler(JSON.parse(atob(message.data)), newMsgCB)
      message.ack()
    })
    // Receive callbacks for errors on the subscription
    sub.on('error', error => {
      console.error('Received error:', error)
      process.exit(1)
    })
  }

  async newMessageHandler(msgData, callback) {
    this.updateHistoryId(msgData.historyId)
      .then((lastHistoryId) => {
        return this.loadHistory(lastHistoryId)
      }).then(async (message) => {
        let mail = await this.getMail(message)
        callback(mail)
      }).catch((err) => {
        console.error(err)
      })
  }

  async updateHistoryId(historyId) {
    return new Promise((resolve, reject) => {
      db.findOne({}, (err, doc) => {
        if (err) return reject(err)
        if (!doc) {
          db.insert({historyId: historyId}, (err, newDoc) => {
            if (err) return reject(err)
            
            return reject('No historyId')
          })
        } else {
          db.update({_id: doc._id}, {$set: {historyId: historyId}}, (err, nb) => {

            return resolve(doc.historyId)
          })
        }
      })
    })
  }

  async loadHistory(historyId) {
    return new Promise(async (resolve, reject) => {
      let response = await this.gmail.users.history.list({
        userId: 'me',
        historyTypes: 'messageAdded',
        startHistoryId: historyId
      })

      await this.updateHistoryId(response.data.historyId)

      if (response.data.history) {
        return resolve(response.data.history[0].messagesAdded[0].message)
        // response.data.history.forEach(h => {
        //   h.messagesAdded.forEach(m => {
        //     console.log(m.message)
        //     return resolve()
        //   })
        // })
      } else {
        return reject("NotANewMail")
      }
    })
  }

  async watchMails() {
    let response = await this.gmail.users.watch({
      userId: 'me',
      requestBody: {
        'labelIds': ['INBOX'],
        'topicName': 'projects/skmail-1602687435666/topics/mesmails'
      }
    })
    this.updateHistoryId(response.data.historyId)
    console.log(response.data)
  }

  loadCredentials() {
    // Load client secrets from a local file.
    fs.readFile(CREDENTIALS_PATH, (err, content) => {
      if (err) return console.log('Error loading client secret file:', err);
      // Authorize a client with credentials, then call the Gmail API.
      this.authorize(JSON.parse(content));
    });
  }

  /**
   * Create an OAuth2 client with the given credentials, and then execute the
   * given callback function.
   * @param {Object} credentials The authorization client credentials.
   * @param {function} callback The callback to call with the authorized client.
   */
  authorize(credentials, callback) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    this.oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]
    );

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
      if (err) return this.getNewToken();
      this.oAuth2Client.setCredentials(JSON.parse(token));
      let auth = this.oAuth2Client
      this.gmail = google.gmail({version: 'v1', auth})
    });
  }

  /**
   * Get and store new token after prompting for user authorization, and then
   * execute the given callback with the authorized OAuth2 client.
   * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
   * @param {getEventsCallback} callback The callback for the authorized client.
   */
  getNewToken() {
    const authUrl = this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      this.oAuth2Client.getToken(code, (err, token) => {
        if (err) return console.error('Error retrieving access token', err);
        this.oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions
        fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
          if (err) return console.error(err);
          console.log('Token stored to', TOKEN_PATH);
        });
        let auth = this.oAuth2Client
        this.gmail = google.gmail({version: 'v1', auth})
      });
    });
  }

  getMails(query, labelIds = 'UNREAD') {
    return new Promise((resolve, reject) => {
      this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        labelIds: labelIds
      }, async (err, res) => {
        if (err) return reject("The API returned an error: " + err)

        return resolve(res.data.messages)
      })
    })
  }

  getMail(mail) {
    return new Promise((resolve, reject) => {
      this.gmail.users.messages.get({
        userId: 'me',
        id: mail.id,
        maxResults: 1
      }, (err, res) => {
        if (err) return reject(err)

        let buff = Buffer.alloc(res.data.payload.parts[0].body.size, res.data.payload.parts[0].body.data, 'base64');
        let text = buff.toString('utf8');
        return resolve(text)
      })  
    })
  }

  async sendMail(from, to, subject, content) {
    const message =
      `From: ${from}\r\n` + 
      `To: ${to}\r\n` +
      `Subject: ${subject}\r\n\r\n` +
      `${content}`;

      // The body needs to be base64url encoded.
      const encodedMessage = btoa(message)
      const reallyEncodedMessage = encodedMessage.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

      let response = await this.gmail.users.messages.send({
          userId: 'me',
          requestBody: {
              raw: reallyEncodedMessage
          }
      })

      return response.data
  }

  async markAsRead(mailId) {
    let response = await this.gmail.users.messages.modify({
      userId: 'me',
      id: mailId,
      requestBody: {
        "addLabelIds": ['INBOX'],
        "removeLabelIds": ['UNREAD']
      }
    })
    return response.data
  }
}

module.exports = GMail