import { useCallback } from "react"

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
      pending,
    }
  }

export const createStreamHook =
  <R extends Runtime<any>>(runtimeAtom: Atom<R> | Atom<Promise<R>>) =>
  <E, A>(createStream: LazyArg<Stream<RuntimeEnv<R>, E, A>>, deps?: any[]) => {
    const runtime = useAtomValue(runtimeAtom)

    const stream = useMemo(createStream, deps)

    const scope = useMemo(() => Scope.make.unsafeRunSync(), [stream])
    useEffect(
      () => () => scope.close(Exit.die("cleanup")).unsafeRunAsync(),
      [scope]
    )

    const pullPromise = useMemo(() => {
      return runtime.unsafeRunPromise(scope.use(stream.rechunk(1).toPull))
    }, [runtime, stream, scope])

    const [initialized, setInitialized] = useState(false)
    const [result, setResult] = useState(null as A)
    const [loading, setLoading] = useState(false)
    const [complete, setComplete] = useState(false)

    const [promise, onInit] = useMemo(() => {
      let resolved = false
      let resolve: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      return [
        promise,
        () => {
          if (resolved) return
          resolved = true
          setInitialized(true)
          resolve()
        },
      ] as const
    }, [setInitialized])

    const pull = useCallback(async () => {
      if (loading || complete) return

      setLoading(true)
      const pull = await pullPromise
      const e = await runtime.unsafeRunPromise(pull.either)
      setLoading(false)

      if (e.isLeft()) {
        if (e.left.isNone()) {
          setComplete(true)
        } else {
          throw e.left.value
        }
      } else {
        setResult(e.right.unsafeHead)
        onInit()
      }
    }, [pullPromise, runtime, complete, loading])

    if (!initialized) {
      throw promise
    }

    return {
      result,
      loading,
      complete,
      pull,
    }
  }
