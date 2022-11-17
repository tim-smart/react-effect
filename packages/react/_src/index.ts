import { useCallback, useEffect, useRef, useState } from "react"

type RuntimeEnv<A> = A extends Runtime<infer R> ? R : never

export const createEffectHook =
  <R extends Runtime<any>>(runtimeAtom: Atom<R> | Atom<Promise<R>>) =>
  <E, A, Args extends any[]>(
    createEffect: (...args: Args) => Effect<RuntimeEnv<R>, E, A>
  ) => {
    const runtime = useAtomValue(runtimeAtom)

    const cancelRef = useRef<Maybe<() => void>>(Maybe.none)
    const [pending, setPending] = useState(false)
    const [result, setResult] = useState<Maybe<Either<Cause<E>, A>>>(Maybe.none)

    const reset = useCallback(() => {
      cancelRef.current = Maybe.none
      setPending(false)
    }, [cancelRef, setPending])

    const run = useCallback(
      (...args: Args) => {
        if (cancelRef.current.isSome()) {
          cancelRef.current.value()
        }
        setPending(true)
        setResult(Maybe.none)

        const cancel = runtime.unsafeRunWith(createEffect(...args), (exit) => {
          reset()

          if (exit.isSuccess()) {
            setResult(Maybe.some(Either.right(exit.value)))
          } else {
            setResult(Maybe.some(Either.left(exit.cause)))
          }
        })

        cancelRef.current = Maybe.some(() => {
          reset()
          cancel(FiberId.none)(() => {})
        })
      },
      [runtime, createEffect, reset]
    )

    useEffect(
      () => () => {
        if (cancelRef.current.isSome()) {
          cancelRef.current.value()
        }
      },
      [cancelRef]
    )

    return {
      result,
      run,
      pending: pending,
    }
  }
