import fc from 'fast-check';

export namespace Spy {

    export type Spied<I extends any[], A> = { args: I, result: A }

    export type SpyingArbitrary<L, A> = {run_: fc.Arbitrary<[() => void, L, A]>}

    export const arbSpyFn = <I extends any[],>() => <A, B = A>(arb: fc.Arbitrary<A>, mapRes?: (a: A) => B):
    SpyingArbitrary<Spied<I, A>[], (...i: I) => B> =>
        ({run_: fc.constant<Spied<I, A>[]>([]).chain(rec =>
            fc.func(arb).map(x => {
                const fn = (...i: I) => {
                const res = x(i);
                rec.push({args: i, result: res })
                return mapRes ? mapRes(res) : (res as unknown as B)
                }
                return [() => { rec.length = 0 },rec, fn]
            })) })

    export type Result<E, A> = { _tag: 'Failure', failure: E } | { _tag: 'Success', success: A }

    export const Result = {
        success: <E>() => <A>(success: A): Result<E, A> => ({ _tag: 'Success', success }),
        failure: <A>() => <E>(failure: E): Result<E, A> => ({ _tag: 'Failure', failure }),
        isSuccess: <E, A>(res: Result<E, A>): res is { _tag: 'Success', success: A } => res._tag === 'Success',
        isFailure: <E, A>(res: Result<E, A>): res is { _tag: 'Failure', failure: E } => res._tag === 'Failure'
    }

    const isWeightedArbitrary = <A>(arb: fc.MaybeWeightedArbitrary<A>): arb is fc.WeightedArbitrary<A> =>
        (arb as fc.WeightedArbitrary<A>).weight !== undefined

    const mapMaybeWeightedArbitrary = <A, B>(arb: fc.MaybeWeightedArbitrary<A>, f: (a: A) => B): fc.MaybeWeightedArbitrary<B> =>
        isWeightedArbitrary(arb)
            ? ({...arb, arbitrary: arb.arbitrary.map(f)})
            : arb.map(f)

    export const arbSpyPromiseFn = <I extends any[],>() =>
        <E, A>(args: {
            onFailure: fc.MaybeWeightedArbitrary<E>,
            onSuccess: fc.MaybeWeightedArbitrary<A>}):
    SpyingArbitrary<Spied<I, Result<E, A>>[], (...i: I) => Promise<A>> =>
        arbSpyFn<I>()<Result<E, A>, Promise<A>>(
            fc.oneof(
                mapMaybeWeightedArbitrary(args.onFailure, Result.failure<A>()),
                mapMaybeWeightedArbitrary(args.onSuccess, Result.success<E>())),
            (x: Result<E, A>) =>
                Result.isSuccess(x)
                ? Promise.resolve(x.success)
                : Promise.reject(x.failure))

    export const toArbitrary = <L, A>(ma: SpyingArbitrary<L, A>): fc.Arbitrary<[L, A]> =>
        ma.run_.map(([c, l, a]) => { c(); return [l, a] })

    export const record = <
        K extends string,
        S extends Record<K, SpyingArbitrary<any, any> | fc.Arbitrary<any>>
    >(s: S): SpyingArbitrary<
      { [K in keyof S]: S[K] extends SpyingArbitrary<infer L, any> ? L : never },
      { [K in keyof S]: S[K] extends SpyingArbitrary<any, infer A>
          ? A 
          : S[K] extends fc.Arbitrary<infer A>
            ? A
            : never
          }
      > => 
      (Object.entries(s) as [K, S[K]][])
      .reduce<Spy.SpyingArbitrary<any, any>>(
        (acc: Spy.SpyingArbitrary<any, any>, [k, v]: [K, S[K]]) =>
            bind(k, () => v as any)(acc), 
        Do as Spy.SpyingArbitrary<{}, {}>)

    const isSpyingArbitrary = <L, A>(ma: SpyingArbitrary<L, A> | fc.Arbitrary<A>): ma is SpyingArbitrary<L, A> =>
        (ma as SpyingArbitrary<L, A>).run_ !== undefined

    export function bind<N extends string, LK extends string, L, A, B>(
    name: Exclude<N, keyof A>,
    f: (a: A) => fc.Arbitrary<B>
    ): (ma: SpyingArbitrary<L, A>) => SpyingArbitrary<
        L, { readonly [K in keyof A | N]: K extends keyof A ? A[K] : B }
    >;

    export function bind<N extends string, LK extends string, L, L2, A, B>(
    name: Exclude<N, keyof A>,
    logKey: Exclude<LK, keyof L>,
    f: (a: A) => SpyingArbitrary<L2, B>
    ): (ma: SpyingArbitrary<L, A>) => SpyingArbitrary<
        L & { readonly [K in keyof L | LK]: K extends keyof L ? L[K] : L2 },
        { readonly [K in keyof A | N]: K extends keyof A ? A[K] : B }
    >;

    export function bind<N extends string, L, L2, A, B>(
    name: Exclude<N, keyof A>,
    f: (a: A) => SpyingArbitrary<L2, B>
    ): (ma: SpyingArbitrary<L, A>) => SpyingArbitrary<
        L & { readonly [K in keyof L | N]: K extends keyof L ? L[K] : L2 },
        { readonly [K in keyof A | N]: K extends keyof A ? A[K] : B }
    >;

    export function bind<N extends string, LK extends string, L, L2, A, B>(
        name: Exclude<N, keyof A>,
        ...rest: [(a: A) => fc.Arbitrary<B>] | 
            [(a: A) => SpyingArbitrary<L2, B>] | 
        [Exclude<LK, keyof L>, (a: A) => SpyingArbitrary<L2, B>]
    ): (ma: SpyingArbitrary<L, A>) => SpyingArbitrary<
        L & { readonly [K in keyof L | LK]: K extends keyof L ? L[K] : L2 } | L,
        { readonly [K in keyof A | N]: K extends keyof A ? A[K] : B }
    > {
    return ({run_: ma}: SpyingArbitrary<L, A>) => ({run_: (() => {
        if (rest.length === 1) {
        return ma.chain(([c, l, a]) => {
            const nxt = rest[0](a)
            if (isSpyingArbitrary(nxt)) {
            return nxt.run_.map(([c2, l2, b]) => [
                () => { c(); c2() },
                Object.assign({}, l, { [name]: l2 }),
                Object.assign({}, a, { [name]: b })
            ] as any)
            }
            return nxt.map((b: B) => [c, l, Object.assign({}, a, { [name]: b }) as any] as const)
        });
        }
        return ma.chain(([c, l, a]) => 
        rest[1](a)
        .run_.map(([c2, l2, b]) => [
            () => { c(); c2() },
            Object.assign({}, l, { [rest[0]]: l2 }),
            Object.assign({}, a, { [name]: b })
        ] as any)
        );
    })()})
    }

    export const map = <L, A, B>(f: (a: A) => B) => (ma: SpyingArbitrary<L, A>): SpyingArbitrary<L, B> =>
    ({run_: ma.run_.map(([c, l, a]) => [c, l, f(a)])})

    export const Do: SpyingArbitrary<{}, {}> = {run_: fc.constant([() => {}, {}, {}])};

    export function pipe<A>(a: A): A
    export function pipe<A, B = never>(a: A, ab: (a: A) => B): B
    export function pipe<A, B = never, C = never>(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C
    ): C
    export function pipe<A, B = never, C = never, D = never>(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D
    ): D
    export function pipe<A, B = never, C = never, D = never, E = never>(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E
    ): E
    export function pipe<A, B = never, C = never, D = never, E = never, F = never>(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F
    ): F
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G
    ): G
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H
    ): H
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I
    ): I
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J
    ): J
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K
    ): K
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L
    ): L
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never,
    M = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L,
    lm: (l: L) => M
    ): M
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never,
    M = never,
    N = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L,
    lm: (l: L) => M,
    mn: (m: M) => N
    ): N
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never,
    M = never,
    N = never,
    O = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L,
    lm: (l: L) => M,
    mn: (m: M) => N,
    no: (n: N) => O
    ): O
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never,
    M = never,
    N = never,
    O = never,
    P = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L,
    lm: (l: L) => M,
    mn: (m: M) => N,
    no: (n: N) => O,
    op: (o: O) => P
    ): P
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never,
    M = never,
    N = never,
    O = never,
    P = never,
    Q = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L,
    lm: (l: L) => M,
    mn: (m: M) => N,
    no: (n: N) => O,
    op: (o: O) => P,
    pq: (p: P) => Q
    ): Q
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never,
    M = never,
    N = never,
    O = never,
    P = never,
    Q = never,
    R = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L,
    lm: (l: L) => M,
    mn: (m: M) => N,
    no: (n: N) => O,
    op: (o: O) => P,
    pq: (p: P) => Q,
    qr: (q: Q) => R
    ): R
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never,
    M = never,
    N = never,
    O = never,
    P = never,
    Q = never,
    R = never,
    S = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L,
    lm: (l: L) => M,
    mn: (m: M) => N,
    no: (n: N) => O,
    op: (o: O) => P,
    pq: (p: P) => Q,
    qr: (q: Q) => R,
    rs: (r: R) => S
    ): S
    export function pipe<
    A,
    B = never,
    C = never,
    D = never,
    E = never,
    F = never,
    G = never,
    H = never,
    I = never,
    J = never,
    K = never,
    L = never,
    M = never,
    N = never,
    O = never,
    P = never,
    Q = never,
    R = never,
    S = never,
    T = never
    >(
    a: A,
    ab: (a: A) => B,
    bc: (b: B) => C,
    cd: (c: C) => D,
    de: (d: D) => E,
    ef: (e: E) => F,
    fg: (f: F) => G,
    gh: (g: G) => H,
    hi: (h: H) => I,
    ij: (i: I) => J,
    jk: (j: J) => K,
    kl: (k: K) => L,
    lm: (l: L) => M,
    mn: (m: M) => N,
    no: (n: N) => O,
    op: (o: O) => P,
    pq: (p: P) => Q,
    qr: (q: Q) => R,
    rs: (r: R) => S,
    st: (s: S) => T
    ): T
    export function pipe(
    a: unknown,
    ab?: Function,
    bc?: Function,
    cd?: Function,
    de?: Function,
    ef?: Function,
    fg?: Function,
    gh?: Function,
    hi?: Function
    ): unknown {
    switch (arguments.length) {
        case 1:
        return a
        case 2:
        return ab!(a)
        case 3:
        return bc!(ab!(a))
        case 4:
        return cd!(bc!(ab!(a)))
        case 5:
        return de!(cd!(bc!(ab!(a))))
        case 6:
        return ef!(de!(cd!(bc!(ab!(a)))))
        case 7:
        return fg!(ef!(de!(cd!(bc!(ab!(a))))))
        case 8:
        return gh!(fg!(ef!(de!(cd!(bc!(ab!(a)))))))
        case 9:
        return hi!(gh!(fg!(ef!(de!(cd!(bc!(ab!(a))))))))
        default: {
        let ret = arguments[0]
        for (let i = 1; i < arguments.length; i++) {
            ret = arguments[i](ret)
        }
        return ret
        }
    }
    }
} 