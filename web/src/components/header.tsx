import Image from "next/image";
import Link from "next/link";

import { ConnectWalletButton } from "@/components/wallet/connect-wallet-button-dynamic";

export function Header() {
  return (
    <header className="flex items-center justify-between border-b py-2 px-8">
      <Link href="/" className="flex items-center gap-2">
        <Image
          src="/logo.png"
          alt="ADApose logo"
          width={65}
          height={65}
        />
        <span className="text-4xl font-semibold tracking-tight">
          <span className="text-brand-crimson">ADA</span>pose
        </span>
      </Link>
      <ConnectWalletButton />
    </header>
  );
}
