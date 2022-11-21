import { useCallback, useEffect } from "react"

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
      pending,
    }
  }

export const createStreamHook =
  <R extends Runtime<any>>(runtimeAtom: Atom<R> | Atom<Promise<R>>) =>
  <E, A>(
    createStream: LazyArg<Stream<RuntimeEnv<R>, E, A>>,
    deps: any[] = []
  ) => {
    const runtime = useAtomValue(runtimeAtom)

    const stream = useMemo(createStream, deps)

    const scope = useMemo(() => Scope.make.unsafeRunSync(), [])
    useEffect(
      () => () => scope.close(Exit.interrupt(FiberId.none)).unsafeRunAsync(),
      [scope]
    )

    const pullPromise = useMemo(
      () => runtime.unsafeRunPromise(scope.use(stream.rechunk(1).toPull)),
      [stream]
    )

    const [result, setResult] = useState<Maybe<Either<E, A>>>(Maybe.none)
    const [loading, setLoading] = useState(false)
    const [complete, setComplete] = useState(false)

    const pull = useCallback(async () => {
      if (loading || complete) return

      setLoading(true)
      const pull = await pullPromise
      const next = await runtime.unsafeRunPromise(pull.either)
      setLoading(false)

      if (next.isLeft()) {
        if (next.left.isNone()) {
          setComplete(true)
        } else {
          setResult(Maybe.some(Either.left(next.left.value)))
        }
      } else {
        setResult(Maybe.some(Either.right(next.right.unsafeHead)))
      }
    }, [pullPromise, complete, loading])

    useEffect(() => {
      pull()
    }, [])

    return {
      result,
      loading,
      complete,
      pull,
    }
  }
