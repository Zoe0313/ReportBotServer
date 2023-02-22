import path from 'path'
import logger from '../../common/logger.js'
import { ExecCommand } from '../../common/utils.js'
import {
   GetUserTz, GetConversationsName, TryAndHandleError
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

const SlashCommandExecutor = async (client, payload) => {
   const messages = await ContentEvaluate(payload)
   logger.info(`stdout of slash command '${payload.command}': ${messages}`)
   // post messages to the channel which is bot in
   const result = await client.chat.postEphemeral({
      channel: payload.channel_id,
      text: messages,
      user: payload.user_id
   })
   if (result?.ok === true) {
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
   } else {
      throw new Error(`post ephemeral response is not ok: ${JSON.stringify(result)}`)
   }
}

const ErrorHandler = async (client, payload, error) => {
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
   // service e2e verify - send error message to monitoring channel
   let errorMessage = 'Slash command: `' + `${slashCommandHistory.command}` + '`'
   errorMessage += ` created by ${GetConversationsName([slashCommandHistory.creator])}` +
      ` in ${GetConversationsName([slashCommandHistory.conversation])} ` +
      ` at ${slashCommandHistory.sendTime}\n`
   errorMessage += `Error: ${slashCommandHistory.errorMsg}`
   client.chat.postMessage({ channel: process.env.ISSUE_CHANNEL_ID, text: errorMessage })
}

const SlashCommandHandler = async (client, payload, ack) => {
   TryAndHandleError({ ack, payload, client }, async () => {
      await ack()
      await SlashCommandExecutor(client, payload)
   }, async (e) => {
      logger.error(`Failed to send an ephemeral message by slash command ${payload?.command}`)
      logger.error(e)
      await ErrorHandler(client, payload, e)
   })
}

export { SlashCommandHandler }
