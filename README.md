# fast-check-spies

A TypeScript library that enhances fast-check's property-based testing with powerful spying capabilities. Track function calls, arguments, and results while maintaining type safety.

## Installation

```bash
npm install fast-check-spies
```

## Prerequisites

This tutorial assumes:
- Familiarity with fast-check's property-based testing concepts
- Understanding of TypeScript and async/await
- Basic knowledge of HTTP APIs and error handling

### Simple Example

Before diving into the full tutorial, here's a basic example showing how to spy on and verify interactions with an arbitrary function:

```typescript
type Calculator = {
  add: (x: number, y: number) => number
}

// Create a spy that generates arbitrary Calculator implementations
const arbCalculator = Spy.record({
  add: Spy.arbSpyFn<[number, number]>()(fc.integer())
})

it('should track calculator usage', () => {
  fc.assert(
    fc.property(
      fc.integer(), fc.integer(),
      Spy.toArbitrary(arbCalculator),
      (x, y, [log, calc]) => {
        // Use the calculator - we don't know what it returns
        const result = calc.add(x, y)
        
        // But we can verify it was called correctly
        expect(log.add[0].args).toEqual([x, y])
        // And we can verify the result
        expect(log.add[0].result).toEqual(result)

      }
    )
  )
})
```

### Anatomy of a Spy

When you create a spy using `arbSpyFn` or `arbSpyPromiseFn`, you get back a tuple of:
1. A log array containing each call's:
   - `args`: The arguments passed to the function
   - `result`: The arbitrary value that was returned
2. The spied function that returns arbitrary values

For async functions, while the function itself returns a `Promise` that resolves or rejects, the spy's logged result is wrapped in a `Result` type to capture both successful and failed outcomes.

## Full Tutorial: Testing User Registration

Here's an example testing an HTTP client with spies. This example demonstrates:
- Spying on multiple functions
- Handling async operations
- Tracking success and failure cases
- Validating complex business logic

```typescript
import fc from 'fast-check'
import { Spy } from 'fast-check-spies'

// Types for our specific use case
type Response<T> = { data: T, status: number }
// Password validation rules
type ValidationError = 'TOO_SHORT' | 'NO_NUMBER' | 'NO_SPECIAL_CHAR'

// User registration specific client
type UserClient = {
  checkUsername: (username: string) => Promise<Response<boolean>>
  createUser: (user: User) => Promise<Response<number>>
  validatePassword: (password: string) => ValidationError | null
}

// Business logic we want to test
type User = { username: string, email: string, password: string }
type RegisterResult = { success: false, message: string } | { success: true, userId: number }

async function registerUser(client: UserClient, user: User): Promise<RegisterResult> {
    // Check if username is available
    const { data: isAvailable } = await client.checkUsername(user.username)
    
    if (!isAvailable) {
      return { success: false, message: 'Username taken' }
    }
    
    // Validate password
    const validation = client.validatePassword(user.password)
    if (validation) {
      return { success: false, message: validation }
    }
    
    // Create the user
    const { data: userId } = await client.createUser(user)
    return { 
      success: true,
      userId
    }
}

// Create an arbitrary for our client
const arbUserClient = (): Spy.SpyingArbitrary<{
  checkUsername: Spy.Spied<[string], Spy.Result<Response<false>, Response<boolean>>>[]  
  createUser: Spy.Spied<[User], Spy.Result<Response<null>, Response<number>>>[]  
  validatePassword: Spy.Spied<[string], ValidationError | null>[]  
}, UserClient> => Spy.pipe(
  Spy.record({
    checkUsername: Spy.arbSpyPromiseFn<[string]>()({ 
      onSuccess: fc.record({ 
        data: fc.boolean(), // username availability
        status: fc.constant(200)
      }),
      onFailure: fc.record({ 
        data: fc.constant<false>(false),
        status: fc.constant(500)
      })
    }),
    createUser: Spy.arbSpyPromiseFn<[User]>()({ 
      onSuccess: fc.record({ 
        data: fc.integer({min: 1}),
        status: fc.constant(201)
      }),
      onFailure: fc.record({ 
        data: fc.constant<null>(null),
        status: fc.constant(400)
      })
    }),
    validatePassword: Spy.arbSpyFn<[string]>()(
      fc.oneof(
        { weight: 4, arbitrary: fc.constant(null) },
        { weight: 1, arbitrary: fc.constantFrom<ValidationError>('TOO_SHORT', 'NO_NUMBER', 'NO_SPECIAL_CHAR') }
      )
    )
  })
)

// Test properties
it('should handle user registration correctly', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({ // Generate test users
        username: fc.string({ minLength: 3 }),
        password: fc.string({ minLength: 3 }),
        email: fc.emailAddress()
      }),
      Spy.toArbitrary(arbUserClient()),
      async (user, [log, client]) => {
        const result = await registerUser(client, user)
            .then(Spy.Result.success<Response<unknown>>())
            .catch(Spy.Result.failure<RegisterResult>())

        // Any calls we made should have the correct input
        if (log.checkUsername.length > 0)
            expect(log.checkUsername[0].args[0]).toBe(user.username)
        if (log.validatePassword.length > 0)
            expect(log.validatePassword[0].args[0]).toBe(user.password)
        if (log.createUser.length > 0)
            expect(log.createUser[0].args[0]).toEqual(user)
        
        // If we succeeded, all calls responded successfully
        if (Spy.Result.isSuccess(result) && result.success.success) {
            expect(log.checkUsername[0]!.result).toEqual(Spy.Result.success()({
                data: true,
                status: 200
            }))
            expect(log.validatePassword[0]!.result).toEqual(null)
            expect(log.createUser[0]!.result).toEqual(Spy.Result.success()({
                data: result.success.userId,
                status: 201
            }))
        }

        // If we failed, we can tie it back to the cause
        if (Spy.Result.isFailure(result)) {
            // checkUsername exception, we forwarded it
            if (log.checkUsername.length > 0 && Spy.Result.isFailure(log.checkUsername[0].result)) {
                expect(log.checkUsername[0].result).toEqual(result)
            }
            // checkUsername responded !available, we translated it
            else if (Spy.Result.isFailure(result) && result.failure.message === 'Username taken') {
                expect(Spy.Result.isSuccess(log.checkUsername[0].result) &&
                 log.checkUsername[0].result.success.data).toEqual(false)
            }
            // validatePassword returned an error, we forwarded it
            else if (log.validatePassword.length > 0 && !!log.validatePassword[0].result) {
                expect(log.validatePassword[0].result).toEqual(result.failure)
            }
            // createUser exception, we forwarded it
            else if (log.createUser.length > 0 && Spy.Result.isFailure(log.createUser[0].result)) {
                expect(log.createUser[0].result).toEqual(result)
            } else {
                // that's all the failures
                expect(true).toBe(false)
            }
        }
      }
    )
  )
})
```

## Core Concepts

### SpyingArbitrary

The main type that combines fast-check arbitraries with spy tracking. It generates:
- A logging object that records all function calls
- An implementation object with the actual functions

### Spy Constructors

Three main types of spy constructors are available:

1. `arbSpyFn` - For synchronous functions
```typescript
Spy.arbSpyFn<[number]>()(fc.integer()) // (n: number) => number
```

2. `arbSpyPromiseFn` - For async functions with success/failure handling
```typescript
Spy.arbSpyPromiseFn<[string]>()({ 
  onSuccess: fc.integer(),
  onFailure: fc.constant('error')
}) // (s: string) => Promise<number>
```

3. `record` - For creating objects with multiple spied functions
```typescript
Spy.record({
  foo: Spy.arbSpyFn<[number]>()(fc.string()),
  bar: Spy.arbSpyFn<[string]>()(fc.integer())
})
// Returns SpyingArbitrary<
//   { foo: Spied<[number], string>[], 
//     bar: Spied<[string], number>[] },
//   { foo: (n: number) => string,
//     bar: (s: string) => number }
// > which when passed to Spy.toArbitrary evaluates to
// fc.Arbitrary<[
// {foo: {args: [number], result: string}[], 
//  bar: {args: [string], result: number}[] 
// },
// { foo: (n: number) => string,
//   bar: (s: string) => number }
// ]>
```

### Composing Arbitraries

Use `pipe` and `bind` to build complex interfaces. Here's an example of building a calculator:

```typescript
type Calculator = {
  add: (x: number, y: number) => number
  multiply: (x: number) => number
  history: number[] // tracks results
}

const arbCalculator = Spy.pipe(
  Spy.Do,
  Spy.bind('add', Spy.arbSpyFn<[number, number]>()(fc.integer())),
  Spy.bind('multiply', 'mult', Spy.arbSpyFn<[number, number]>()(fc.integer())),
  // Add history field using regular arbitrary
  Spy.bind('history', () => fc.array(fc.integer()))
)

// The result type would be:
// SpyingArbitrary<
//   { add: Spied<[number, number], number>[], 
//     mult: Spied<[number, number], number>[] },
//   Calculator
// > which when passed to Spy.toArbitrary evaluates to
// fc.Arbitrary<[
// {add: {args: [number, number], result: number}[], 
//  mult: {args: [number, number], result: number}[] 
// },
// Calculator]>
```

The `bind` function has several forms:
1. `bind(name, arbitraryFn)` - binds a regular fast-check arbitrary
2. `bind(name, logKey, spyFn)` - binds a spy with its logs stored at logKey
3. `bind(name, spyFn)` - binds a spy with its logs stored at name

## API Reference

### Main Functions

- `arbSpyFn<I extends any[]>()`: Creates a spy for sync functions
  - Args: `<A, B = A>(arb: fc.Arbitrary<A>, mapRes?: (a: A) => B)`
  - Returns: `SpyingArbitrary<Spied<I, A>[], (...i: I) => B>`

- `arbSpyPromiseFn<I extends any[]>()`: Creates a spy for async functions
  - Args: `<E, A>({ onSuccess: fc.Arbitrary<A>, onFailure: fc.Arbitrary<E> })`
  - Returns: `SpyingArbitrary<Spied<I, Result<E, A>>[], (...i: I) => Promise<A>>`

- `record<S>`: Creates an object with multiple spies
  - Args: `s: Record<string, SpyingArbitrary<any, any> | fc.Arbitrary<any>>`
  - Returns: `SpyingArbitrary<Record<...>, Record<...>>`

### Utility Functions

- `toArbitrary`: Converts a SpyingArbitrary to a regular fast-check arbitrary
- `bind`: Adds new fields to an existing SpyingArbitrary (see fast-check `bind`)
- `map`: Maps over the implementation of a SpyingArbitrary (see fast-check `map`)
- `pipe`: Chains multiple operations on SpyingArbitrary
- `Result`: Namespace for handling async results
  - `success`: Creates a successful result
  - `failure`: Creates a failed result
  - `isSuccess`: Type guard for successful results
  - `isFailure`: Type guard for failed results

## License

MIT
