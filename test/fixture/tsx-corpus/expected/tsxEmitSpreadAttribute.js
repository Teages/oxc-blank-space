// @strict: false
// @jsx: react
// @target: es2015,es2018,esnext
// @filename: test.tsx

                         

export function T1(a     ) {
    return <div className={"T1"} { ...a }>T1</div>;
}

export function T2(a     , b     ) {
    return <div className={"T2"} { ...a } { ...b }>T2</div>;
}

export function T3(a     , b     ) {
    return <div { ...a } className={"T3"} { ...b }>T3</div>;
}

export function T4(a     , b     ) {
    return <div className={"T4"} { ...{ ...a, ...b } }>T4</div>;
}

export function T5(a     , b     , c     , d     ) {
    return <div className={"T5"} { ...{ ...a, ...b, ...{ c, d } } }>T5</div>;
}

export function T6(a     , b     , c     , d     ) {
    return <div className={"T6"} { ...{ ...a, ...b, ...{ ...c, ...d } } }>T6</div>;
}

export function T7(a     , b     , c     , d     ) {
    return <div className={"T7"} { ...{ __proto__: null, dir: 'rtl' } }>T7</div>;
}

export function T8(a     , b     , c     , d     ) {
    return <div className={"T8"} { ...{ "__proto__": null } }>T8</div>;
}

;                               

export function T9(a     , b     , c     , d     ) {
    return <div className={"T9"} { ...{ [__proto__]: null } }>T9</div>;
}

export function T10(a     , b     , c     , d     ) {
    return <div className={"T10"} { ...{ ["__proto__"]: null } }>T10</div>;
}

export function T11(a     , b     , c     , d     ) {
    return <div className={"T11"} { ...{ __proto__ } }>T11</div>;
}
