import { atom, Getter } from "jotai"

export const atomWithRef = <A>(
  create: (get: Getter) => Pick<SubscriptionRef<A>, "changes" | "get">
) => {
  const atomInAtom = atom((get) => {
    const ref = create(get)
    const resultAtom = atom(ref.get.unsafeRunSync())

    resultAtom.onMount = (update) => {
      const cancel = ref.changes
        .tap((a) =>
          Effect.sync(() => {
            update(a)
          })
        )
        .runDrain.unsafeRunWith(() => {})

      return () => cancel(FiberId.none)(() => {})
    }

    return resultAtom
  })

  return atom((get) => get(get(atomInAtom)))
}

export const createAtomWithStream =
  <R extends Runtime<any>>(createRuntime: (get: Getter) => R) =>
  <E, A>(
    create: (get: Getter) => Stream<RuntimeEnv<R>, E, A>,
    initialValue: Maybe<A> = Maybe.none
  ) => {
    const atomInAtom = atom((get) => {
      const runtime = createRuntime(get)
      const stream = create(get)

      let cancel: (() => void) | undefined
      let update: (a: A) => void

      const resume = () => {
        const newCancel = runtime.unsafeRunWith(
          stream.tap((a) =>
            Effect.sync(() => {
              update(a)
            })
          ).runDrain,
          () => {}
        )
        cancel = () => newCancel(FiberId.none)(() => {})
      }

      const resultAtom = atom(
        initialValue.fold(
          () =>
            new Promise<A>((r) => {
              update = r
              resume()
            }),
          identity
        )
      )

      resultAtom.onMount = (newUpdate) => {
        update = newUpdate
        if (!cancel) {
          resume()
        }

        return () => {
          cancel?.()
          cancel = undefined
        }
      }

      return resultAtom
    })

    return atom((get) => get(get(atomInAtom)))
  }

type RuntimeEnv<A> = A extends Runtime<infer R> ? R : never

export const createAtomWithEffect =
  <R extends Runtime<any>>(createRuntime: (get: Getter) => R) =>
  <E, A>(create: (get: Getter) => Effect<RuntimeEnv<R>, E, A>) =>
    atom((get) => {
      const runtime = createRuntime(get)
      const effect = create(get)
      return runtime.unsafeRunPromise(effect)
    })

export const runtimeScopeAtom = atom(() => Scope.make.unsafeRunSync())

export const runtimeAtomFromLayer = <R>(layer: Layer<never, unknown, R>) =>
  atom((get) => get(runtimeScopeAtom).use(layer.toRuntime()).unsafeRunPromise())
