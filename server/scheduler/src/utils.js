import moment from 'moment-timezone'


export function format_date(date) {
    if (date == null) 
        return ''
    try {
        return moment(date).tz('Asia/Shanghai').format('YYYY-MM-DD')
    } catch (e) {
        console.error(e)
        return ''
    }
}

export function format_date_time(date) {
    if (date == null) 
        return ''
    try {
        return moment(date).tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm')
    } catch (e) {
        console.error(e)
        return ''
    }
}