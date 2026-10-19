/** Sahkarmi mark: two overlapping rounded shapes — two coworkers side by side. */
export function LogoMark(props: { size?: number; class?: string }) {
  const size = () => props.size ?? 28;
  return (
    <svg
      class={`logo-mark ${props.class ?? ""}`}
      width={size()}
      height={size()}
      viewBox="0 0 120 120"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="sahkarmi-logo-left">
          <rect x="14" y="30" width="58" height="74" rx="29" />
        </clipPath>
      </defs>
      <rect class="logo-mark__indigo" x="14" y="30" width="58" height="74" rx="29" />
      <rect x="48" y="16" width="58" height="74" rx="29" fill="#E8772E" />
      <rect
        x="48"
        y="16"
        width="58"
        height="74"
        rx="29"
        fill="#8E3F1E"
        clip-path="url(#sahkarmi-logo-left)"
      />
    </svg>
  );
}
