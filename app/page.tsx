"use client";

import Navbar       from "@/components/Navbar";
import Hero         from "@/components/Hero";
import Showreel     from "@/components/Showreel";
import About        from "@/components/About";
import Services     from "@/components/Services";
import Portfolio    from "@/components/Portfolio";
import WhyKian      from "@/components/WhyKian";
import Process      from "@/components/Process";
import Industries   from "@/components/Industries";
import Testimonials from "@/components/Testimonials";
import Contact      from "@/components/Contact";
import Footer       from "@/components/Footer";
import Cursor       from "@/components/Cursor";
import WaFloat      from "@/components/WaFloat";
import Marquee      from "@/components/Marquee";

export default function Home() {
  return (
    <>
      <Cursor />
      <WaFloat />
      <Navbar />
      <main>
        <Hero />
        <Showreel />
        <Marquee />
        <About />
        <Services />
        <Portfolio />
        <WhyKian />
        <Process />
        <Industries />
        <Testimonials />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
