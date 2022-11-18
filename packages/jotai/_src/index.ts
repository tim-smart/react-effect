import { atom, Getter } from "jotai"
import { RESET } from "jotai/utils"

type RESET = typeof RESET

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
  <E, A>(create: (get: Getter) => Stream<RuntimeEnv<R>, E, A>) => {
    const resetCount = atom(0)

    const atomInAtom = atom(async (get) => {
      get(resetCount)

      const runtime = createRuntime(get)
      const scope = Scope.make.unsafeRunSync()
      const stream = create(get)
      const pull = await pipe(
        scope.use(stream.rechunk(1).toPull),
        runtime.unsafeRunPromise
      )

      type Result = Either<Maybe<E>, Chunk<A>>
      const resultAtom = atom<Result>(
        runtime.unsafeRunPromise(pull.either) as any as Result
      )
      const loadingAtom = atom(false)
      const completeAtom = atom(false)

      const valueAtom = atom(
        (get) =>
          get(resultAtom).fold(
            (m) =>
              m.fold(
                () => new Promise<A>(() => {}),
                (e) => Promise.reject<A>(e)
              ),
            (c) => c.unsafeHead
          ),
        (get, set, _update: void) => {
          const complete = get(completeAtom)
          if (complete) return

          set(loadingAtom, true)
          runtime.unsafeRunPromise(pull.either).then((e) => {
            set(loadingAtom, false)

            if (e.isLeft()) {
              if (e.left.isNone()) {
                set(completeAtom, true)
              } else {
                set(resultAtom, e)
              }
            } else {
              set(resultAtom, e)
            }
          })
        }
      )

      return [valueAtom, loadingAtom, completeAtom, scope] as const
    })

    return atom(
      (get) => {
        const [valueAtom, loadingAtom, completeAtom] = get(atomInAtom)

        return {
          data: get(valueAtom),
          loading: get(loadingAtom),
          complete: get(completeAtom),
        }
      },
      (get, set, update: void | RESET) => {
        const [valueAtom, , , scope] = get(atomInAtom)

        if (update !== RESET) {
          set(valueAtom)
        } else {
          scope
            .close(Exit.die("reset"))
            .tap(() =>
              Effect.sync(() => {
                set(resetCount, (i) => i + 1)
              })
            )
            .unsafeRunAsync()
        }
      }
    )
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
