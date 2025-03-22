import Lifecycle from '../src/index.js'

// Create a lifecycle manager for a database connection
const lifecycle = new Lifecycle({
    async open () {
        console.log('Opening database connection')
        // Connect to database
    },

    async suspend () {
        console.log('Suspending database connection')
        // Close connection
    },

    async resume () {
        console.log('Resuming database connection')
        // Reconnect
    },

    async close () {
        console.log('Closing database connection')
        // Disconnect and clean up resources
    },
})

// Register for transition notifications
lifecycle.on((transition) => {
    console.log(`Database state changed to: ${transition}`)
})

// start opening without awaiting the `opened` state
lifecycle.open()

if (lifecycle.is('opening')) {
    console.log('Database is initializing...')
}

// Wait for specific state
await lifecycle.until('opened')
console.log('Database ready!')

await lifecycle.suspend()
await lifecycle.resume()
await lifecycle.close()
