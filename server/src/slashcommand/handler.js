import axios from 'axios'
import logger from '../../common/logger.js'
import {
   GetUserTz, GetConversationsName, TryAndHandleError,
   LoadSlashCommandUsage
} from '../../common/slack-helper.js'
import {
   SLASH_COMMAND_HISTORY_STATUS, SlashCommandHistory
} from '../model/slashcommand-history.js'
import {
   GenerateNannyReply, GenerateVSANNannyReply
} from './nanny-generator.js'

const ContentEvaluate = async (payload) => {
   // execute the different slash command response generator
   // Get user's time zone
   const tz = await GetUserTz(payload.user_id)
   let stdout = ''
   if (payload.command === '/whois-vsan-nanny' || payload.command === '/whois-vsan-nanny-test') {
      stdout = await GenerateVSANNannyReply(payload, tz)
   } else if (payload.command === '/whois-nanny' || payload.command === '/whois-nanny-test') {
      stdout = await GenerateNannyReply(payload, tz)
   } else {
      throw new Error(`slash command ${payload.command} not supported.`)
   }
   return stdout
}

const SlashCommandExecutor = async (ack, payload) => {
   const completeCommand = payload.command + ((payload.text.length > 0) ? (' ' + payload.text) : '')
   const slashCommandHistory = new SlashCommandHistory({
      creator: payload.user_id,
      conversation: payload.channel_id,
      command: completeCommand,
      sendTime: null,
      errorMsg: '',
      status: SLASH_COMMAND_HISTORY_STATUS.PENDING
   })
   logger.debug(`${payload.user_name} executed slash command: '${completeCommand}'`)
   const messages = await ContentEvaluate(payload)
   logger.info(`stdout of slash command '${completeCommand}': ${messages}`)
   // post ephemeral messages to channel by response url
   const res = await axios.post(payload.response_url, {
      text: messages
   })
   if (res.data === 'ok') {
      slashCommandHistory.status = SLASH_COMMAND_HISTORY_STATUS.SUCCEED
      slashCommandHistory.sendTime = new Date()
      await slashCommandHistory.save()
      logger.info(`record: ${slashCommandHistory}`)
   } else {
      throw new Error(`Failed to post message by ${payload.response_url}.`)
   }
}

const ErrorHandler = async (client, ack, payload, error) => {
   const slashCommandHistory = new SlashCommandHistory({
      creator: payload.user_id,
      conversation: payload.channel_id,
      command: payload.command + ((payload.text.length > 0) ? (' ' + payload.text) : ''),
      sendTime: null,
      errorMsg: error.message,
      status: SLASH_COMMAND_HISTORY_STATUS.FAILED
   })
   if (error.signal === 'SIGTERM') {
      slashCommandHistory.status = SLASH_COMMAND_HISTORY_STATUS.TIMEOUT
   } else if (error.message.startsWith('Command failed:')) {
      try {
         slashCommandHistory.status = SLASH_COMMAND_HISTORY_STATUS.USER_ERROR
         const usage = LoadSlashCommandUsage(payload.command.replace('/', ''))
         // post ephemeral command usage messages to channel by response url
         await axios.post(payload.response_url, {
            text: '```USAGE:\n' + `${usage}` + '```'
         })
      } catch (e) {
         logger.error(`Send command usage failed since error:`)
         logger.error(e)
      }
   } else {
      // service e2e verify - send error message to monitoring channel
      let errorMessage = 'Slash command: `' + `${slashCommandHistory.command}` + '`'
      errorMessage += ` created by ${GetConversationsName([slashCommandHistory.creator])}` +
         ` in ${GetConversationsName([slashCommandHistory.conversation])} ` +
         ` at ${slashCommandHistory.sendTime}\n`
      errorMessage += `Error: ${slashCommandHistory.errorMsg}`
      client.chat.postMessage({ channel: process.env.ISSUE_CHANNEL_ID, text: errorMessage })
   }
   try {
      await slashCommandHistory.save()
      logger.info(`record: ${slashCommandHistory}`)
   } catch (e) {
      logger.error(`Save failed slash command history failed since error:`)
      logger.error(e)
   }
}

const SlashCommandHandler = async (client, payload, ack) => {
   TryAndHandleError({ ack, payload, client }, async () => {
      await ack()
      await SlashCommandExecutor(ack, payload)
   }, async (e) => {
      logger.error(`Failed to send an ephemeral message by slash command ${payload?.command}`)
      logger.error(e)
      await ErrorHandler(client, ack, payload, e)
   })
}

export { SlashCommandHandler }
