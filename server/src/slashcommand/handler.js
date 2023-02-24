import path from 'path'
import logger from '../../common/logger.js'
import { ExecCommand } from '../../common/utils.js'
import {
   GetUserTz, GetConversationsName, TryAndHandleError,
   LoadSlashCommandUsage
} from '../../common/slack-helper.js'
import {
   SLASH_COMMAND_HISTORY_STATUS, SlashCommandHistory
} from '../model/slashcommand-history.js'

const projectRootPath = path.join(path.resolve(), '..')

const ContentEvaluate = async (payload) => {
   // execute the different slash command response generator
   const timeout = 10 * 60 * 1000
   let scriptPath = ''
   let stdout = ''
   let command = ''
   switch (payload.command) {
      case '/whois-vsan-nanny': {
         // Get user's time zone
         const tz = await GetUserTz(payload.user_id)
         const param = payload?.text || 'now'
         scriptPath = projectRootPath + '/generator/src/notification/vsan_nanny.py'
         command = `PYTHONPATH=${projectRootPath} python3 ${scriptPath} ` +
            `--tz '${tz}' --param '${param}'`
         logger.debug(`execute slash command /whois-vsan-nanny response generator: ${command}`)
         stdout = await ExecCommand(command, timeout)
         break
      }
      default:
         throw new Error(`slash command ${payload.command} not supported.`)
   }
   return stdout
}

const SlashCommandExecutor = async (ack, payload) => {
   const messages = await ContentEvaluate(payload)
   logger.info(`stdout of slash command '${payload.command}':\n${messages}`)
   // post ephemeral messages to channel by ack
   await ack({
      response_type: 'ephemeral',
      text: messages
   })
   const slashCommandHistory = new SlashCommandHistory({
      creator: payload.user_id,
      conversation: payload.channel_id,
      command: payload.command + ((payload.text.length > 0) ? (' ' + payload.text) : ''),
      sendTime: new Date(),
      errorMsg: '',
      status: SLASH_COMMAND_HISTORY_STATUS.SUCCEED
   })
   await slashCommandHistory.save()
   logger.info(`record: ${slashCommandHistory}`)
}

const ErrorHandler = async (client, ack, payload, error) => {
   const slashCommandHistory = new SlashCommandHistory({
      creator: payload.user_id,
      conversation: payload.channel_id,
      command: payload.command + ((payload.text.length > 0) ? (' ' + payload.text) : ''),
      sendTime: new Date(),
      errorMsg: error.message,
      status: SLASH_COMMAND_HISTORY_STATUS.FAILED
   })
   if (error.signal === 'SIGTERM') {
      slashCommandHistory.status = SLASH_COMMAND_HISTORY_STATUS.TIMEOUT
   }
   try {
      await slashCommandHistory.save()
      logger.info(`record: ${slashCommandHistory}`)
   } catch (e) {
      logger.error(`Save failed slash command history failed since error:`)
      logger.error(e)
   }
   if (error.message.startsWith('Command failed:') &&
      error.message.includes('error: argument')) {
      try {
         const usage = LoadSlashCommandUsage(payload.command.replace('/', ''))
         // post ephemeral command usage messages to channel by ack
         await ack({
            response_type: 'ephemeral',
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
}

const SlashCommandHandler = async (client, payload, ack) => {
   TryAndHandleError({ ack, payload, client }, async () => {
      await SlashCommandExecutor(ack, payload)
   }, async (e) => {
      logger.error(`Failed to send an ephemeral message by slash command ${payload?.command}`)
      logger.error(e)
      await ErrorHandler(client, ack, payload, e)
   })
}

export { SlashCommandHandler }
