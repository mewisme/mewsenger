import { User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { Translate } from "@/i18n";
import type { AccountRef } from "@/ui/local-view";

/** What a tab or menu row calls an account: Messenger's name for the user, or "Anonymous" until they are signed in. */
export function accountLabel(account: AccountRef, t: Translate): string {
  return account.name.trim() || t("account.anonymous");
}

/** The signed-in user's picture; their initial, or a plain person, until it is known. */
export function AccountAvatar({ account, className }: { account: AccountRef; className?: string }) {
  const initial = Array.from(account.name.trim())[0]?.toUpperCase();
  return (
    <Avatar aria-hidden="true" className={cn("size-5", className)}>
      {account.picture && <AvatarImage src={account.picture} alt="" />}
      <AvatarFallback className="bg-primary/15 text-[10px] font-semibold leading-none text-primary">
        {initial ?? <User className="size-3" />}
      </AvatarFallback>
    </Avatar>
  );
}
