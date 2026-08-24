import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

const slides = [
  {
    title: "Fresh groceries, delivered fast",
    subtitle: "Fruits, vegetables & essentials at your doorstep in 60 minutes",
    cta: "Shop now",
    href: "/products",
    image: "https://picsum.photos/seed/hero-groceries/1200/500",
  },
  {
    title: "Up to 30% off on staples",
    subtitle: "Stock up on atta, rice, dal and cooking oils",
    cta: "Explore deals",
    href: "/categories/staples-grains",
    image: "https://picsum.photos/seed/hero-staples/1200/500",
  },
  {
    title: "Farm-fresh fruits & vegetables",
    subtitle: "Handpicked daily for peak freshness",
    cta: "Shop produce",
    href: "/categories/fruits-vegetables",
    image: "https://picsum.photos/seed/hero-produce/1200/500",
  },
];

export function HeroCarousel() {
  return (
    <Carousel opts={{ loop: true }} className="w-full">
      <CarouselContent>
        {slides.map((slide) => (
          <CarouselItem key={slide.title}>
            <div className="relative aspect-[16/7] overflow-hidden rounded-2xl sm:aspect-[16/5]">
              <img
                src={slide.image}
                alt={slide.title}
                className="size-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-center gap-3 px-6 sm:px-12">
                <h2 className="max-w-md font-heading text-2xl font-bold text-white sm:text-4xl">
                  {slide.title}
                </h2>
                <p className="max-w-sm text-sm text-white/90 sm:text-base">
                  {slide.subtitle}
                </p>
                <Button
                  className="w-fit"
                  nativeButton={false}
                  render={<Link href={slide.href} />}
                >
                  {slide.cta}
                </Button>
              </div>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious className="left-3" />
      <CarouselNext className="right-3" />
    </Carousel>
  );
}
