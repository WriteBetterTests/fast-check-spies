import fc from 'fast-check'
import { arbSpyFn, bind, Do, getSpy,map,pipe, Spied, SpyingArbitrary } from './fast-check-spies';

type Interface = {
    foo: (x: number) => string
    bar: (x: string) => number
    baz: (x: string, y: number) => string
    fooInputs: number[],
    barInputs: string[],
    bazInputs: [string, number][],

}

type Log = {
    foo: Spied<string>[],
    bar: Spied<number>[],
    baz: Spied<string>[]
}

const arbInterface = (): SpyingArbitrary<Log, Interface> => pipe(
    Do,
    bind('foo', 'foo', () => arbSpyFn<[number]>()(fc.string())),
    bind('bar', 'bar', () => arbSpyFn<[string]>()(fc.integer())),
    bind('baz', 'baz', () => arbSpyFn<[string, number]>()(fc.webUrl())),
    bind('fooInputs', () => fc.array(fc.integer(), {minLength: 1, maxLength: 10})),
    bind('barInputs', () => fc.array(fc.string(), {minLength: 1, maxLength: 10})),
    bind('bazInputs', () => fc.array(fc.tuple(fc.string(), fc.integer()), {minLength: 1, maxLength: 10})),
)

type Tp<A, B> = {l: A, r: B}

const arbInfs = (): SpyingArbitrary<Tp<Log, Log>, Tp<Interface, Interface>> => pipe(
    Do,
    bind('l', 'l', () => arbInterface()),
    bind('r', 'r', () => arbInterface())
)

it('should work', () => {
    fc.assert(fc.property(arbInfs(), (spy) => {
        const [{r: log}, {r: ifc}] = getSpy(spy)
        expect(ifc.fooInputs.map(x => ifc.foo(x))).toEqual(log.foo.map(x => x.result))
        expect(log.foo.flatMap(x => x.args)).toEqual(ifc.fooInputs)
        expect(ifc.barInputs.map(x => ifc.bar(x))).toEqual(log.bar.map(x => x.result))
        expect(log.bar.flatMap(x => x.args)).toEqual(ifc.barInputs)
        expect(ifc.bazInputs.map(([x,y]) => ifc.baz(x,y))).toEqual(log.baz.map(x => x.result))
        expect(log.baz.map(x => x.args)).toEqual(ifc.bazInputs)
    }))
})
    

