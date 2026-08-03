"use client";

import { I18nProvider } from "@/lib/i18n";
import Navbar       from "@/components/Navbar";
import Hero         from "@/components/Hero";
import Showreel     from "@/components/Showreel";
import About        from "@/components/About";
import Services     from "@/components/Services";
import Portfolio    from "@/components/Portfolio";
import Stats        from "@/components/Stats";
import WhyKian      from "@/components/WhyKian";
import Process      from "@/components/Process";
import Industries   from "@/components/Industries";
import Clients      from "@/components/Clients";
import Reviews      from "@/components/Reviews";
import Social       from "@/components/Social";
import Contact      from "@/components/Contact";
import Footer       from "@/components/Footer";
import Cursor       from "@/components/Cursor";
import WaFloat      from "@/components/WaFloat";
import Marquee      from "@/components/Marquee";
import OpportunityPromo from "@/components/OpportunityPromo";
// يعيد null ما لم تكن ميزة دراسات الحالة مفعّلة ويوجد محتوى منشور — فلا يظهر
// قسم فارغ ولا رابط إلى صفحة «قريبًا». شبكة الأعمال أعلاه لم تُمسّ.
import CaseStudiesTeaser from "@/components/CaseStudiesTeaser";

export default function Home() {
  return (
    <I18nProvider>
      <Cursor />
      <WaFloat />
      <OpportunityPromo />
      <Navbar />
      <main>
        <Hero />
        <Showreel />
        <Marquee />
        <About />
        <Services />
        <Portfolio />
        <CaseStudiesTeaser />
        <Stats />
        <WhyKian />
        <Process />
        <Industries />
        <Clients />
        <Reviews />
        <Social />
        <Contact />
      </main>
      <Footer />
    </I18nProvider>
  );
}
