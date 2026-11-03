import debian from "../assets/distributions/debian.svg";
import ubuntu from "../assets/distributions/ubuntu.svg";
import fedora from "../assets/distributions/fedora.svg";
import kali from "../assets/distributions/kalilinux.svg";
import opensuse from "../assets/distributions/opensuse.svg";
import arch from "../assets/distributions/archlinux.svg";
import alpine from "../assets/distributions/alpinelinux.svg";
import alma from "../assets/distributions/almalinux.svg";
import rocky from "../assets/distributions/rockylinux.svg";
import generic from "../assets/icons/penguin.svg";

// Identify common WSL registration names without starting a distribution to probe it.
// Custom names that cannot be recognized use the generic Linux icon.
const icons: [RegExp, string][] = [
  [/^debian(?:$|[-_.\s]|\d)/i, debian],
  [/^ubuntu(?:$|[-_.\s]|\d)/i, ubuntu],
  [/^fedora(?:linux)?(?:$|[-_.\s]|\d)/i, fedora],
  [/^kali(?:-linux)?(?:$|[-_.\s]|\d)/i, kali],
  [/^opensuse(?:$|[-_.\s]|\d)/i, opensuse],
  [/^arch(?:linux)?(?:$|[-_.\s]|\d)/i, arch],
  [/^alpine(?:linux)?(?:$|[-_.\s]|\d)/i, alpine],
  [/^alma(?:linux)?(?:$|[-_.\s]|\d)/i, alma],
  [/^rocky(?:linux)?(?:$|[-_.\s]|\d)/i, rocky],
];

export function distributionIcon(name: string): string {
  return icons.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? generic;
}
