# lifecycling

> Resource management. It's like riding a lifecycle.

An agile little module for handling open, close, suspend, resume lifecycle transitions.

## Install

```
npm i lifecycling
```

## Example

```js
import Lifecycle from 'lifecycling'

// create a lifecycle manager for a database connection
const lifecycle = new Lifecycle({
    async open () {
        console.log('Opening database connection')
        // connect to database
    },

    async suspend () {
        console.log('Suspending database connection')
        // close connection
    },

    async resume () {
        console.log('Resuming database connection')
        // reconnect
    },

    async close () {
        console.log('Closing database connection')
        // disconnect and clean up resources
    },
})

// register for transition notifications
lifecycle.on((transition) => {
    console.log(`Database state changed to: ${transition}`)
})

// start opening without awaiting the `opened` state
lifecycle.open()

if (lifecycle.is('opening')) {
    console.log('Database is initializing...')
}

// wait for specific state
await lifecycle.until('opened')
console.log('Database ready!')

// suspend!
await lifecycle.suspend()

// resume!
await lifecycle.resume()

// close!
await lifecycle.close()
```
