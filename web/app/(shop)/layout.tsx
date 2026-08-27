import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { ChatLauncher } from "@/components/chat/chat-launcher";

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <ChatLauncher />
    </>
  );
}
