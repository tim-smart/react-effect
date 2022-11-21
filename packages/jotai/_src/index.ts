import { atom, Getter, Setter } from "jotai"
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

export interface AtomWithStreamOpts {
  keepAlive?: boolean
}

export const createAtomWithStream =
  <R extends Runtime<any>>(createRuntime: (get: Getter) => R) =>
  <E, A>(create: (get: Getter) => Stream<RuntimeEnv<R>, E, A>) => {
    const atomInAtom = atom(async (get) => {
      const runtime = createRuntime(get)

      const make = async () => {
        const scope = Scope.make.unsafeRunSync()
        const stream = create(get)
        const pull = await pipe(
          scope.use(stream.rechunk(1).toPull),
          runtime.unsafeRunPromise
        )
        const close = () =>
          scope.close(Exit.interrupt(FiberId.none)).unsafeRunPromise()

        return { pull: pull.either, close }
      }

      let handle = await make()
      const reset = async (set: Setter) => {
        handle.close()
        handle = await make()
        set(completeAtom, false)
        set(valueAtom)
      }

      type Result = Either<Maybe<E>, Chunk<A>>
      const resultAtom = atom<Result>(
        runtime.unsafeRunPromise(handle.pull) as any as Result
      )
      const loadingAtom = atom(false)
      const completeAtom = atom(false)

      const valueAtom = atom(
        (get): Promise<Either<E, A>> =>
          get(resultAtom).fold(
            (m) =>
              m.fold(
                () => new Promise(() => {}),
                (e) => Promise.reject(Either.left(e))
              ),
            (c) => Either.right(c.unsafeHead)
          ),
        (get, set, _update: void) => {
          const complete = get(completeAtom)
          if (complete) return

          set(loadingAtom, true)

          runtime.unsafeRunPromise(handle.pull).then((e) => {
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

      return [valueAtom, loadingAtom, completeAtom, reset] as const
    })

    return atom(
      (get) => {
        const [valueAtom, loadingAtom, completeAtom] = get(atomInAtom)

        return {
          result: get(valueAtom),
          loading: get(loadingAtom),
          complete: get(completeAtom),
        }
      },
      async (get, set, update: void | RESET) => {
        const [valueAtom, , , reset] = get(atomInAtom)

        if (update !== RESET) {
          set(valueAtom)
        } else {
          await reset(set)
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
      return runtime.unsafeRunPromise(effect.either)
    })

export const runtimeScopeAtom = atom(() => Scope.make.unsafeRunSync())

export const runtimeAtomFromLayer = <R>(layer: Layer<never, unknown, R>) =>
  atom((get) => get(runtimeScopeAtom).use(layer.toRuntime()).unsafeRunPromise())
