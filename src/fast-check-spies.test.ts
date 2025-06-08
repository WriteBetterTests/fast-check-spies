import fc from 'fast-check'
import { Spy } from './fast-check-spies';

type Interface = {
    foo: (x: number) => string
    bar: (x: string) => number
    baz: (x: string, y: number) => string
    quux: (x: number) => Promise<number>
    fooInputs: number[],
    barInputs: string[],
    bazInputs: [string, number][],
    quuxInputs: number[],
}

type Log = {
    foo: Spy.Spied<[number], number>[],
    bar: Spy.Spied<[string], number>[],
    bazz: Spy.Spied<[string, number], string>[]
    quux: Spy.Spied<[number], Spy.Result<string, number>>[]
}

const arbInterface = (): Spy.SpyingArbitrary<Log, Interface> => Spy.pipe(
    Spy.record({
        foo: Spy.arbSpyFn<[number]>()(fc.integer(), x => x.toString()),
        bar: Spy.arbSpyFn<[string]>()(fc.integer()),
        quux: Spy.arbSpyPromiseFn<[number]>()({
            onFailure: { weight: 1, arbitrary: fc.string()},
            onSuccess: { weight: 4, arbitrary: fc.integer()} }),
        fooInputs: fc.array(fc.integer(), {minLength: 1, maxLength: 10}),
        barInputs: fc.array(fc.string(), {minLength: 1, maxLength: 10}),
        quuxInputs: fc.array(fc.integer(), {minLength: 1, maxLength: 10})
    }),
    Spy.bind('baz', 'bazz', () => Spy.arbSpyFn<[string, number]>()(fc.webUrl())),
    Spy.bind('bazInputs', () => fc.array(fc.tuple(fc.string(), fc.integer()), {minLength: 1, maxLength: 10})),
)

type Tp<A, B> = {l: A, r: B}

const arbInfs = (): Spy.SpyingArbitrary<Tp<Log, Log>, Tp<Interface, Interface>> => Spy.pipe(
    Spy.Do,
    Spy.bind('l', 'l', () => arbInterface()),
    Spy.bind('r', 'r', () => arbInterface())
)

it('should work', async () => {
    await fc.assert(fc.asyncProperty(Spy.toArbitrary(arbInfs()), async (spy) => {
        const [{l: log}, {l: ifc}] = spy
        expect(ifc.fooInputs.map(x => ifc.foo(x))).toEqual(log.foo.map(x => x.result.toString()))
        expect(log.foo.flatMap(x => x.args)).toEqual(ifc.fooInputs)
        expect(ifc.barInputs.map(x => ifc.bar(x))).toEqual(log.bar.map(x => x.result))
        expect(log.bar.flatMap(x => x.args)).toEqual(ifc.barInputs)
        expect(ifc.bazInputs.map(([x,y]) => ifc.baz(x,y))).toEqual(log.bazz.map(x => x.result))
        expect(log.bazz.map(x => x.args)).toEqual(ifc.bazInputs)
        const quuxResults = await Promise.all(ifc.quuxInputs.map(x => 
            ifc.quux(x).then(Spy.Result.success<string>())
            .catch(Spy.Result.failure<number>())
        ))
        expect(quuxResults).toEqual(log.quux.map(x => x.result))
        expect(log.quux.flatMap(x => x.args)).toEqual(ifc.quuxInputs)
    }))
})

// Verify tutorial in README 

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