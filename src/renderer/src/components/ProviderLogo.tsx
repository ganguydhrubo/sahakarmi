import { Show } from "solid-js";
import type { AgentProviderId } from "../../../shared/ipc";
import { providerCatalogEntry } from "../../../shared/provider-catalog";
import { BRAND_MARKS, type BrandMarkId } from "../brand-marks";

/**
 * The provider's own brand mark on a soft tile. Marks without a brand colour follow the theme's
 * text colour; providers with no published mark get their initial.
 */
export function ProviderLogo(props: { provider: AgentProviderId; size?: number; tile?: boolean }) {
  const entry = () => providerCatalogEntry(props.provider);
  const mark = () => {
    const id = entry()?.mark;
    return id && id in BRAND_MARKS ? BRAND_MARKS[id as BrandMarkId] : undefined;
  };
  const size = () => props.size ?? 20;
  return (
    <span
      class="provider-logo"
      classList={{ "provider-logo-tile": props.tile }}
      style={{ "--provider-logo-size": `${size()}px` }}
      aria-hidden="true"
    >
      <Show
        when={mark()}
        fallback={<span class="provider-logo-initial">{entry()?.name.charAt(0) ?? "?"}</span>}
      >
        {(brand) => (
          <svg viewBox="0 0 24 24" width={size()} height={size()} role="presentation">
            <path d={brand().path} fill={brand().color ?? "currentColor"} />
          </svg>
        )}
      </Show>
    </span>
  );
}
