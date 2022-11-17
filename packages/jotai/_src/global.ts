import "@effect/core/global"

/**
 * @tsplus global
 */
import {
  atom,
  useAtomValue,
  useSetAtom,
  Atom,
  PrimitiveAtom,
  WritableAtom,
} from "jotai"

/**
 * @tsplus global
 */
import {
  atomWithRef,
  createAtomWithEffect,
  createAtomWithStream,
  runtimeScopeAtom,
  runtimeAtomFromLayer,
} from "@react-effect/jotai"
