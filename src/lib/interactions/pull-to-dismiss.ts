const controls =
	'button, input, select, textarea, a, summary, [contenteditable], [role="button"], [role="slider"], [role="listbox"], [popover]';

/** Mobile-only dismissal; scrollable content must start at the top. */
export function pullToDismiss(node: HTMLDialogElement, dismiss: () => void) {
	const mobile = window.matchMedia("(max-width: 1023px)");
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const originalTranslate = node.style.translate;
	let gesture:
		| { id: number; x: number; y: number; distance: number; dragging: boolean }
		| undefined;
	let settling: Animation | undefined;
	let dismissing = false;

	function reset() {
		gesture = undefined;
		dismissing = false;
		settling?.cancel();
		settling = undefined;
		node.style.translate = originalTranslate;
	}

	function returnToStart() {
		const distance = gesture?.distance ?? 0;
		reset();
		if (!distance || reducedMotion.matches || !node.open) return;
		const animation = node.animate(
			[
				{ translate: `0 ${distance}px` },
				{ translate: originalTranslate || "0 0" },
			],
			{ duration: 180, easing: "ease-out" },
		);
		settling = animation;
		void animation.finished.then(
			() => {
				if (settling === animation) settling = undefined;
			},
			() => {
				/* Closing or starting another pull cancels the return animation. */
			},
		);
	}

	function start(event: TouchEvent) {
		if (event.touches.length !== 1) {
			returnToStart();
			return;
		}
		if (!mobile.matches || !node.open || dismissing) return;
		const target = event.target;
		if (
			!(target instanceof Element) ||
			!node.contains(target) ||
			target.closest(controls)
		)
			return;
		// A downward gesture in scrolled content belongs to scrolling, not dismissal.
		for (
			let parent: Element | null = target;
			parent && parent !== node;
			parent = parent.parentElement
		) {
			if (parent.scrollTop > 0) return;
		}
		reset();
		const touch = event.touches[0];
		gesture = {
			id: touch.identifier,
			x: touch.clientX,
			y: touch.clientY,
			distance: 0,
			dragging: false,
		};
	}

	function move(event: TouchEvent) {
		if (!gesture) return;
		if (event.touches.length !== 1 || !event.cancelable) {
			returnToStart();
			return;
		}
		const touch = event.touches[0];
		if (touch.identifier !== gesture.id) {
			returnToStart();
			return;
		}
		const down = touch.clientY - gesture.y;
		const across = Math.abs(touch.clientX - gesture.x);
		if (!gesture.dragging && (down <= 0 || across > down)) {
			gesture = undefined;
			return;
		}
		event.preventDefault();
		gesture.dragging = true;
		gesture.distance = Math.max(0, Math.min(down, node.clientHeight));
		// Separate translation preserves the existing sheet entrance/exit animation.
		node.style.translate = `0 ${gesture.distance}px`;
	}

	function end(event: TouchEvent) {
		if (!gesture) return;
		if (
			event.touches.length ||
			!Array.from(event.changedTouches).some(
				(touch) => touch.identifier === gesture?.id,
			)
		) {
			returnToStart();
			return;
		}
		if (gesture.distance >= Math.min(96, node.clientHeight * 0.2)) {
			gesture = undefined;
			dismissing = true;
			dismiss();
		} else returnToStart();
	}

	node.addEventListener("touchstart", start, { passive: true });
	node.addEventListener("touchmove", move, { passive: false });
	node.addEventListener("touchend", end);
	node.addEventListener("touchcancel", returnToStart);
	node.addEventListener("close", reset);
	mobile.addEventListener("change", reset);
	return {
		destroy() {
			node.removeEventListener("touchstart", start);
			node.removeEventListener("touchmove", move);
			node.removeEventListener("touchend", end);
			node.removeEventListener("touchcancel", returnToStart);
			node.removeEventListener("close", reset);
			mobile.removeEventListener("change", reset);
			reset();
		},
	};
}
