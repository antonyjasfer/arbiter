import { signOut } from "@/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function UserMenu({ name, image }: { name: string; image?: string | null }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-8">
        {image ? <AvatarImage src={image} alt="" /> : null}
        <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="hidden text-sm sm:inline">{name}</span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <Button variant="ghost" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </div>
  );
}
