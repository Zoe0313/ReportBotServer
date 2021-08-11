import moment from 'moment-timezone'
import logger from '../../src/logger.js'

export function formatDate(date) {
   if (date == null) {
      return ''
   }
   try {
      return moment(date).tz('Asia/Shanghai').format('YYYY-MM-DD')
   } catch (e) {
      logger.error(e)
      return ''
   }
}

export function formatDateTime(date) {
   if (date == null) {
      return ''
   }
   try {
      return moment(date).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm')
   } catch (e) {
      logger.error(e)
      return ''
   }
}