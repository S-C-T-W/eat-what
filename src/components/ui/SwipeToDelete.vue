<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * iOS-style swipe row: drag left to reveal a delete button. Parent controls
 * which row is open (one at a time) via v-model:open.
 */
const props = defineProps<{ open: boolean; label: string }>()
const emit = defineEmits<{ 'update:open': [boolean]; delete: [] }>()

const ACTION_W = 80
const dragX = ref(0)
const dragging = ref(false)
let startX = 0
let startY = 0
let horizontal: boolean | null = null

const offset = computed(() => (dragging.value ? dragX.value : props.open ? -ACTION_W : 0))

watch(
  () => props.open,
  () => {
    dragging.value = false
  },
)

function onStart(e: PointerEvent) {
  startX = e.clientX
  startY = e.clientY
  horizontal = null
  dragX.value = props.open ? -ACTION_W : 0
}

function onMove(e: PointerEvent) {
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  if (horizontal === null) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    horizontal = Math.abs(dx) > Math.abs(dy)
  }
  if (!horizontal) return
  dragging.value = true
  const base = props.open ? -ACTION_W : 0
  dragX.value = Math.min(0, Math.max(-ACTION_W - 20, base + dx))
}

function onEnd() {
  if (!dragging.value) return
  dragging.value = false
  emit('update:open', dragX.value < -ACTION_W / 2)
}
</script>

<template>
  <div class="relative overflow-hidden rounded-2xl">
    <!-- revealed action -->
    <button
      type="button"
      class="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-red-500 text-sm font-bold text-white"
      :tabindex="open ? 0 : -1"
      @click="emit('delete')"
    >
      {{ label }}
    </button>
    <!-- sliding content — painted with the PAGE background so a translucent
         card (e.g. the upcoming row's sky-950/40 in dark mode) composes over
         the page colour, not over the red button underneath. Without this the
         delete action bleeds through the row while it slides. -->
    <div
      class="relative touch-pan-y bg-orange-50 dark:bg-stone-950"
      :class="dragging ? '' : 'transition-transform duration-200'"
      :style="{ transform: `translateX(${offset}px)` }"
      @pointerdown="onStart"
      @pointermove="onMove"
      @pointerup="onEnd"
      @pointercancel="onEnd"
      @click.capture="open && ($event.stopPropagation(), emit('update:open', false))"
    >
      <slot />
    </div>
  </div>
</template>
