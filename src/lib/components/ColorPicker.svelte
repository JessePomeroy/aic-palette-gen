<script lang="ts">
    import { onMount, tick } from 'svelte';
    import type { ExtractedColor } from '$lib/colors/extraction';

    let { colors, label, value = $bindable(0) }: {
        colors: ExtractedColor[];
        label: string;
        value?: number;
    } = $props();
    const id = $props.id();
    let trigger: HTMLButtonElement;
    let menu: HTMLDivElement;
    let open = $state(false);
    let active = $state(0);
    let closing = $state(false);
    let pointerIntent: 'open' | 'close' | null = null;
    let selected = $derived(Math.max(0, Math.min(value, colors.length - 1)));
    let motionFrame = 0;
    let motionVersion = 0;
    let motionAnimation: Animation | undefined;

    function stopMotion() {
        ++motionVersion;
        cancelAnimationFrame(motionFrame);
        motionAnimation?.cancel();
        motionAnimation = undefined;
        menu.style.removeProperty('opacity');
    }
    function playMotion(keyframes: Keyframe[], duration: number, easing: string, complete?: () => void) {
        const version = motionVersion;
        motionAnimation = menu.animate(keyframes, { duration, easing, fill: 'both' });
        motionAnimation.pause();
        motionAnimation.currentTime = 0;
        let previous = performance.now();
        let elapsed = 0;
        const advance = (now: number) => {
            if (version !== motionVersion || !motionAnimation) return;
            // Keep either direction visible even when WebKit stalls a frame.
            elapsed = window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? duration : Math.min(duration, elapsed + Math.min(now - previous, 32));
            previous = now;
            motionAnimation.currentTime = elapsed;
            if (elapsed < duration) motionFrame = requestAnimationFrame(advance);
            else { motionAnimation.finish(); complete?.(); }
        };
        motionFrame = requestAnimationFrame(advance);
    }
    function animateEntrance() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const version = motionVersion;
        menu.style.opacity = '0';
        // WebKit can consume a CSS entrance while preparing the popover's first
        // paint. Establish the open surface before starting the visible motion.
        motionFrame = requestAnimationFrame(() => {
            motionFrame = requestAnimationFrame(() => {
                if (version !== motionVersion || !menu.matches(':popover-open')) return;
                if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    playMotion([
                        { opacity: 0, transform: 'scale(.84)' },
                        { opacity: 1, transform: 'scale(1)' },
                    ], 300, 'cubic-bezier(.2,.65,.3,1)');
                }
                menu.style.removeProperty('opacity');
            });
        });
    }

    function positionMenu() {
        const rect = trigger.getBoundingClientRect();
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const width = viewport?.width ?? window.innerWidth;
        const height = viewport?.height ?? window.innerHeight;
        const menuWidth = Math.min(260, width - 24);
        const menuHeight = Math.min(colors.length * 48 + 16, height - 24);
        const below = rect.bottom + 6;
        const opensBelow = below + menuHeight <= top + height - 12;
        menu.style.width = `${menuWidth}px`;
        menu.style.maxHeight = `${menuHeight}px`;
        menu.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - menuWidth - 12))}px`;
        menu.style.top = `${Math.max(top + 12, Math.min(opensBelow ? below : rect.top - menuHeight - 6, top + height - menuHeight - 12))}px`;
        menu.style.transformOrigin = opensBelow ? 'top center' : 'bottom center';
    }
    async function focusOption(index: number) {
        active = index;
        await tick();
        if (menu.matches(':popover-open')) menu.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.focus({ preventScroll: true });
    }
    function toggled() {
        open = menu.matches(':popover-open');
        if (open && !menu.contains(document.activeElement)) void focusOption(active);
    }
    function beforeToggle(event: ToggleEvent) {
        stopMotion();
        open = event.newState === 'open';
        closing = false;
        if (event.newState !== 'open') return;
        window.dispatchEvent(new CustomEvent('chroma:color-picker-open', { detail: menu }));
        positionMenu();
        animateEntrance();
        void focusOption(selected);
    }
    function close(restoreFocus = false, immediate = false) {
        if (!menu?.matches(':popover-open') || (closing && !immediate)) return;
        const style = getComputedStyle(menu);
        const from = { opacity: style.opacity, transform: style.transform };
        stopMotion();
        closing = true;
        const finish = () => {
            const returnFocus = restoreFocus && (menu.contains(document.activeElement)
                || document.activeElement === trigger || document.activeElement === document.body);
            if (menu.matches(':popover-open')) menu.hidePopover();
            if (returnFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
        };
        if (immediate || Number(from.opacity) === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
        else playMotion([from, { opacity: 0, transform: 'scale(.84)' }], 200, 'ease-in', finish);
    }
    function toggleMenu(event: MouseEvent) {
        event.preventDefault();
        // Focus dismissal can run between pointerdown and click. Honor the tap's
        // original intent even if the closing animation finishes in that gap.
        const intent = pointerIntent ?? (menu.matches(':popover-open') ? 'close' : 'open');
        pointerIntent = null;
        if (intent === 'close') close(true);
        else if (!closing && !menu.matches(':popover-open')) menu.showPopover();
    }
    function choose(index: number) {
        if (closing) return;
        value = index;
        close(true);
    }
    function keydown(event: KeyboardEvent) {
        const last = colors.length - 1;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? last
                : (active + (event.key === 'ArrowDown' ? 1 : -1) + colors.length) % colors.length;
            void focusOption(index);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(true);
        } else if (event.key === 'Tab') {
            trigger.focus({ preventScroll: true });
            close();
        }
    }
    function triggerKeydown(event: KeyboardEvent) {
        pointerIntent = null;
        if (menu.matches(':popover-open')) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                choose(active);
            } else keydown(event);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            menu.showPopover();
            void focusOption(selected);
        }
    }
    onMount(() => {
        const reposition = (event: Event) => {
            if (event.target instanceof Node && menu.contains(event.target)) return;
            if (menu.matches(':popover-open')) positionMenu();
        };
        const dismiss = () => close(false, true);
        const outside = (event: Event) => {
            if (event.target instanceof Node && !menu.contains(event.target) && !trigger.contains(event.target)) close();
        };
        const anotherPicker = (event: Event) => {
            if (event instanceof CustomEvent && event.detail !== menu) close();
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('focusin', outside);
        window.addEventListener('chroma:color-picker-open', anotherPicker);
        const sheet = trigger.closest('dialog');
        window.addEventListener('resize', reposition);
        window.visualViewport?.addEventListener('resize', reposition);
        window.visualViewport?.addEventListener('scroll', reposition);
        document.addEventListener('scroll', reposition, true);
        sheet?.addEventListener('close', dismiss);
        return () => {
            stopMotion();
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('focusin', outside);
            window.removeEventListener('chroma:color-picker-open', anotherPicker);
            window.removeEventListener('resize', reposition);
            window.visualViewport?.removeEventListener('resize', reposition);
            window.visualViewport?.removeEventListener('scroll', reposition);
            document.removeEventListener('scroll', reposition, true);
            sheet?.removeEventListener('close', dismiss);
        };
    });
</script>

<div class="color-picker">
    <span id={`${id}-label`} class="picker-label">{label}</span>
    <button bind:this={trigger} type="button" class="picker-trigger" aria-controls={id} aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${id}-label ${id}-value`} disabled={!colors.length} onpointerdown={() => { pointerIntent = menu.matches(':popover-open') ? 'close' : 'open'; }} onpointercancel={() => { pointerIntent = null; }} onkeydown={triggerKeydown} onclick={toggleMenu}>
        <span class="color-square" style={`background: ${colors[selected]?.hex ?? 'transparent'}`} aria-hidden="true"></span>
        <span id={`${id}-value`}>{selected + 1} · {colors[selected]?.hex ?? 'No colors'}</span>
        <span class="picker-chevron" aria-hidden="true">⌄</span>
    </button>
    <div bind:this={menu} {id} popover="manual" class="color-menu" data-closing={closing} role="listbox" tabindex="-1" aria-labelledby={`${id}-label`} onbeforetoggle={beforeToggle} ontoggle={toggled} onkeydown={keydown}>
        {#each colors as color, i}
            <button type="button" role="option" class="color-option" aria-selected={i === selected} tabindex={i === active ? 0 : -1} onclick={() => choose(i)}>
                <span class="selection-check" aria-hidden="true">{i === selected ? '✓' : ''}</span>
                <span class="color-square" style={`background: ${color.hex}`} aria-hidden="true"></span>
                <span>{i + 1} · {color.hex}</span>
            </button>
        {/each}
    </div>
</div>

<style>
    .color-picker { flex: 1; min-width: 0; }
    .picker-label { display: block; margin-bottom: 8px; font-size: 14px; }
    .picker-trigger { width: 100%; display: flex; align-items: center; gap: 7px; min-height: 44px; padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); text-align: left; font-size: 13px; white-space: nowrap; cursor: pointer; }
    .picker-chevron { margin-left: auto; color: var(--text-secondary); }
    .color-square { display: inline-block; width: 18px; height: 18px; flex-shrink: 0; border-radius: 3px; border: 1px solid rgb(0 0 0 / .22); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .15); }
    .color-menu { position: fixed; inset: auto; margin: 0; box-sizing: border-box; padding: 8px; border: 1px solid rgb(255 255 255 / .55); border-radius: 18px; background: #d8d7d5; color: #191919; box-shadow: 0 12px 40px rgb(0 0 0 / .32); overflow-y: auto; overscroll-behavior: contain; }
    .color-menu[data-closing='true'] { pointer-events: none; }
    .color-option { width: 100%; display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 10px; border-radius: 9px; font-size: 17px; text-align: left; cursor: pointer; }
    .selection-check { width: 17px; flex-shrink: 0; font-size: 19px; }
    .color-option:hover, .color-option:focus-visible { background: rgb(255 255 255 / .45); outline: 2px solid #666; outline-offset: -2px; }
    @media (max-width: 360px) { .color-picker { flex-basis: 100%; } }
</style>
