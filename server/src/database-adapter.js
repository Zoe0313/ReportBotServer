import mongoose from 'mongoose'


function mongo_database(open_fn) {
    mongoose.connect(`mongodb://${process.env.MONGO_HOST}:${process.env.MONGO_PORT}/${process.env.MONGO_DB}`, 
        { useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex: true }
    )
    mongoose.set('useFindAndModify', false)
    const db = mongoose.connection;
    db.on('error', console.error.bind(console, 'connection error:'));
    db.once('open', function() {
        console.log('connected to mongodb')
        if (open_fn) {
            open_fn()
        }
    });
}

export { mongo_database } 
