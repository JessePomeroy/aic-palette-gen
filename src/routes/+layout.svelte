<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { analytics } from '$lib/analytics';

	let { children } = $props();

	// Initialize Vercel analytics
	analytics();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Chroma Collection" />
	<meta property="og:description" content="Generate color palettes from artworks in the Art Institute of Chicago collection" />
	<meta property="og:image" content="https://chromacollection.online/og-image.png" />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Chroma Collection" />
	<meta name="twitter:description" content="Generate color palettes from artworks in the Art Institute of Chicago collection" />
	<meta name="twitter:image" content="https://chromacollection.online/og-image.png" />
</svelte:head>

{@render children()}
