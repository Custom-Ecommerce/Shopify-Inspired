"use client";

import React from "react";
import Link from "next/link";
import { Facebook, Instagram, Twitter, MoveUpRight } from "lucide-react";
import { Button } from "../../shared/components/primitives/button";
import { Input } from "../../shared/components/primitives/input";
import { footerDictionary } from "../../shared/constants/dictionary";
import type { FooterProps } from "../../types";
import { BrandDisplay } from "../../components/brand/BrandDisplay";

const socialIconMap = {
  facebook: Facebook,
  instagram: Instagram,
  twitter: Twitter,
  site: MoveUpRight,
} as const;

/** A store's own social links, in the order they are shown. Only the ones the seller saved. */
function liveSocialLinks(social: NonNullable<FooterProps["config"]["social"]>) {
  const entries: Array<{ key: string; label: string; href: string | null; icon: keyof typeof socialIconMap }> = [
    { key: "facebook", label: "Facebook", href: social.facebook, icon: "facebook" },
    { key: "instagram", label: "Instagram", href: social.instagram, icon: "instagram" },
    { key: "tiktok", label: "TikTok", href: social.tiktok, icon: "site" },
    { key: "whatsapp", label: "WhatsApp", href: social.whatsapp, icon: "site" },
  ];
  return entries.filter((entry): entry is typeof entry & { href: string } => entry.href !== null);
}

/** wa.me wants digits only. */
const whatsappLink = (number: string) => "https://wa.me/" + number.replace(/\D/g, "");

export function Footer({ config }: FooterProps) {
  const contact = config.contact;
  const live = contact !== undefined;
  const hasContact = live && Boolean(contact.phone || contact.whatsapp || contact.email || contact.address || contact.city);
  return (
    <footer data-source="partial" data-source-note="Brand name and logo come from the store; links, newsletter and copy are theme content." data-section="footer" className="bg-[var(--surface-inverse)] text-primary-foreground py-20 px-margin-mobile md:px-margin-desktop">
      <div className="max-w-container-max w-full mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24">
          {/* LEFT COLUMN: Logo & App Links */}
          <div className="flex flex-col gap-10">
            <div className="h-13 w-20 md:h-18 md:w-25"> 
              <BrandDisplay brand={config.brand} />
            </div>

            {config.brand.description ? (
              <p className="font-sans text-[14px] leading-relaxed opacity-80 max-w-[420px] whitespace-pre-line [overflow-wrap:anywhere]">{config.brand.description}</p>
            ) : null}

            {hasContact && contact ? (
              <ul data-section="contact" className="flex flex-col gap-2 font-sans text-[13px] opacity-90 [overflow-wrap:anywhere]">
                {contact.phone ? (
                  <li>
                    <a href={"tel:" + contact.phone} className="hover:underline">Call {contact.phone}</a>
                  </li>
                ) : null}
                {contact.whatsapp ? (
                  <li>
                    <a href={whatsappLink(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="hover:underline">WhatsApp {contact.whatsapp}</a>
                  </li>
                ) : null}
                {contact.email ? (
                  <li>
                    <a href={"mailto:" + contact.email} className="hover:underline">{contact.email}</a>
                  </li>
                ) : null}
                {contact.address || contact.city ? <li>{[contact.address, contact.city].filter(Boolean).join(", ")}</li> : null}
              </ul>
            ) : null}

            {config.storeLinks && config.storeLinks.length > 0 ? (
              <ul data-section="store-links" aria-label="Store pages" className="flex flex-wrap gap-x-6 gap-y-1 font-sans text-[13px] [overflow-wrap:anywhere]">
                {config.storeLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="inline-flex min-h-11 items-center opacity-90 hover:opacity-100 hover:underline">{link.label}</Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <ul className="flex flex-col gap-5 mt-2">
              {footerDictionary.navLinks.map((link) => (
                <li key={link}>
                  <Link
                    href={`#${link.toLowerCase()}`}
                    className="font-sans text-[12px] tracking-widest uppercase opacity-80 hover:opacity-100 transition-opacity block"
                  >
                    {link}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* RIGHT COLUMN: Sign Up Form & Socials */}
          <div className="flex flex-col lg:pl-12 border-primary-foreground/20">
            <h3 className="font-heading text-[28px] md:text-[36px] uppercase mb-8 leading-tight max-w-[400px]">
              {config.newsletter.heading}
            </h3>

            <form className="flex flex-col gap-6 w-full max-w-md" onSubmit={(e) => e.preventDefault()}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Input
                  type="text"
                  placeholder={footerDictionary.firstNamePlaceholder}
                  className="border-0 border-b border-primary-foreground/30 rounded-none bg-transparent px-0 text-[15px] text-primary-foreground focus-visible:ring-0 focus-visible:border-primary-foreground shadow-none placeholder:text-primary-foreground/50"
                />
                <Input
                  type="text"
                  placeholder={footerDictionary.lastNamePlaceholder}
                  className="border-0 border-b border-primary-foreground/30 rounded-none bg-transparent px-0 text-[15px] text-primary-foreground focus-visible:ring-0 focus-visible:border-primary-foreground shadow-none placeholder:text-primary-foreground/50"
                />
              </div>

              <div className="relative mt-4 group">
                <Input
                  type="email"
                  placeholder={footerDictionary.emailPlaceholder}
                  className="border-0 border-b border-primary-foreground/30 rounded-none bg-transparent px-0 pr-32 text-[15px] text-primary-foreground focus-visible:ring-0 focus-visible:border-primary-foreground shadow-none placeholder:text-primary-foreground/50"
                />
                <Button
                  type="submit"
                  variant="ghost"
                  className="absolute right-0 top-0 h-full rounded-none font-sans text-[13px] font-bold tracking-widest uppercase hover:bg-transparent hover:text-primary-foreground/70 text-primary-foreground px-0 transition-colors"
                >
                  {config.newsletter.buttonText}
                </Button>
              </div>
            </form>

            <div className="flex items-center gap-6 mt-16">
              {live
                ? config.social
                  ? liveSocialLinks(config.social).map(({ key, label, href, icon }) => {
                      const Icon = socialIconMap[icon];
                      return (
                        <a key={key} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="opacity-80 hover:opacity-100 transition-opacity">
                          <Icon size={20} />
                        </a>
                      );
                    })
                  : null
                : footerDictionary.socialLinks.map(({ platform, href }) => {
                    const Icon = socialIconMap[platform];
                    return (
                      <Link key={platform} href={href} className="opacity-80 hover:opacity-100 transition-opacity">
                        <Icon size={20} />
                      </Link>
                    );
                  })}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
