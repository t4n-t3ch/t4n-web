import Link from "next/link";

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-[#0f0f11] text-[#e2e2e8]">
            <div className="max-w-3xl mx-auto px-6 py-16">
                {/* Header */}
                <div className="mb-12">
                    <Link href="/" className="text-[#f97316] hover:underline text-sm mb-6 inline-block">
                        ← Back to T4N
                    </Link>
                    <h1 className="text-4xl font-bold text-[#f97316] mb-2">Terms of Service</h1>
                    <p className="text-[#9ca3af]">Last Updated: 11/03/2026</p>
                </div>

                {/* Content */}
                <div className="space-y-8 text-[#d1d5db] leading-relaxed">
                    <p className="text-sm text-[#9ca3af] border-l-2 border-[#f97316] pl-4">
                        These Terms of Service (&quot;Terms&quot;) govern your access to and use of the T4N platform and related services (&quot;Service&quot;) operated by T4N LTD (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
                    </p>

                    <p>By accessing or using the Service, you agree to be bound by these Terms. If you do not agree to these Terms, you may not use the Service.</p>

                    <Section title="1. Description of the Service">
                        <p>T4N is an AI-powered coding workspace that allows users to generate, edit, store, and manage code through artificial intelligence systems.</p>
                        <p className="mt-2">The platform may include features such as:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>AI-assisted code generation</li>
                            <li>project and snippet storage</li>
                            <li>debugging assistance</li>
                            <li>workspace editing tools</li>
                            <li>integrations with third-party AI providers</li>
                        </ul>
                        <p className="mt-2">The Service may evolve over time and new features may be added or removed.</p>
                    </Section>

                    <Section title="2. User Accounts">
                        <p>To use certain features of the Service you may be required to create an account.</p>
                        <p className="mt-2">You agree that:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>the information you provide is accurate and complete</li>
                            <li>you will keep your account credentials secure</li>
                            <li>you are responsible for all activity under your account</li>
                        </ul>
                        <p className="mt-2">We reserve the right to suspend or terminate accounts that violate these Terms.</p>
                    </Section>

                    <Section title="3. Acceptable Use">
                        <p>You agree not to use the Service for any unlawful or harmful purpose.</p>
                        <p className="mt-2">You must not:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>attempt to disrupt or interfere with the Service</li>
                            <li>attempt to gain unauthorized access to systems or data</li>
                            <li>use the platform to generate malicious software or exploit systems</li>
                            <li>use the Service in violation of applicable laws or regulations</li>
                        </ul>
                        <p className="mt-2">We reserve the right to suspend or terminate access for violations.</p>
                    </Section>

                    <Section title="4. AI Generated Content">
                        <p>T4N uses artificial intelligence models to generate code and responses.</p>
                        <p>AI-generated output may contain errors, omissions, or unintended behavior.</p>
                        <p className="mt-2">You acknowledge and agree that:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>AI-generated code is provided for informational and development purposes</li>
                            <li>you are responsible for reviewing, testing, and validating any code before use</li>
                            <li>the Company is not responsible for errors in AI-generated content</li>
                        </ul>
                        <p className="mt-2">You assume full responsibility for the use of generated code.</p>
                    </Section>

                    <Section title="5. No Financial or Trading Advice">
                        <p>The Service may be used to generate trading strategies, financial models, or automated scripts.</p>
                        <p className="font-semibold text-[#f97316]">T4N does not provide financial advice.</p>
                        <p className="mt-2">Any trading strategies, indicators, or automated systems generated through the Service are provided for informational purposes only.</p>
                        <p>You are solely responsible for evaluating and testing any trading-related code or strategies before using them in real trading environments.</p>
                        <p className="mt-2">The Company is not responsible for any financial losses resulting from the use of generated code.</p>
                    </Section>

                    <Section title="6. User Content and Code Ownership">
                        <p>You retain ownership of any code, prompts, projects, or other content you create or upload through the Service.</p>
                        <p>By using the Service you grant T4N a limited license to store, process, and display this content for the purpose of providing the Service.</p>
                        <p className="mt-2">We do not claim ownership of your code or projects.</p>
                    </Section>

                    <Section title="7. Data Storage">
                        <p>The Service may store information including:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>code snippets</li>
                            <li>project data</li>
                            <li>chat messages</li>
                            <li>usage logs</li>
                        </ul>
                        <p className="mt-2">This data is stored in order to provide functionality such as project history, snippet management, and AI context.</p>
                        <p>For more information on data handling, please review the <Link href="/privacy" className="text-[#f97316] hover:underline">Privacy Policy</Link>.</p>
                    </Section>

                    <Section title="8. Subscriptions and Billing">
                        <p>Certain features of the Service may require a paid subscription.</p>
                        <p>Subscriptions are billed on a recurring basis through our payment provider.</p>
                        <p className="mt-2">By purchasing a subscription you agree that:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>payments will be charged automatically at the selected billing interval</li>
                            <li>you are responsible for maintaining valid payment information</li>
                            <li>subscriptions will continue until cancelled</li>
                        </ul>
                        <p className="mt-2">You may cancel your subscription at any time through your account settings or billing portal.</p>
                        <p>Refunds are provided only where required by law.</p>
                    </Section>

                    <Section title="9. Third-Party Services">
                        <p>T4N may rely on third-party services to operate, including but not limited to:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>payment processors</li>
                            <li>authentication providers</li>
                            <li>AI model providers</li>
                            <li>hosting platforms</li>
                        </ul>
                        <p className="mt-2">Your use of the Service may be subject to the terms of those third-party providers.</p>
                        <p>We are not responsible for the availability or behavior of third-party services.</p>
                    </Section>

                    <Section title="10. Service Availability">
                        <p>We aim to provide a reliable service but cannot guarantee uninterrupted access.</p>
                        <p>The Service may be temporarily unavailable due to:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>maintenance</li>
                            <li>updates</li>
                            <li>infrastructure issues</li>
                            <li>third-party outages</li>
                        </ul>
                        <p className="mt-2">We reserve the right to modify or discontinue parts of the Service at any time.</p>
                    </Section>

                    <Section title="11. Limitation of Liability">
                        <p>To the maximum extent permitted by law, T4N and its operators shall not be liable for any indirect, incidental, or consequential damages arising from the use of the Service.</p>
                        <p className="mt-2">This includes but is not limited to:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>financial losses</li>
                            <li>trading losses</li>
                            <li>lost profits</li>
                            <li>loss of data</li>
                            <li>system failures</li>
                        </ul>
                        <p className="mt-4">The Service is provided on an "as is" and "as available" basis without warranties of any kind.</p>
                    </Section>

                    <Section title="12. Termination">
                        <p>We reserve the right to suspend or terminate access to the Service if:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>these Terms are violated</li>
                            <li>unlawful activity is suspected</li>
                            <li>the Service is abused or misused</li>
                        </ul>
                        <p className="mt-2">You may also terminate your account at any time.</p>
                    </Section>

                    <Section title="13. Changes to These Terms">
                        <p>We may update these Terms from time to time.</p>
                        <p>When changes occur, the updated version will be posted on the website with a revised "Last Updated" date.</p>
                        <p>Continued use of the Service after changes constitutes acceptance of the updated Terms.</p>
                    </Section>

                    <Section title="14. Governing Law">
                        <p>These Terms shall be governed by and interpreted in accordance with the laws of the United Kingdom.</p>
                        <p>Any disputes arising from the use of the Service shall be subject to the jurisdiction of the courts of the United Kingdom.</p>
                    </Section>

                    <Section title="15. Contact">
                        <p>If you have any questions about these Terms, please contact:</p>
                        <div className="mt-2 p-4 bg-[#1e1e24] rounded-lg border border-[#2a2a35]">
                            <p className="font-semibold">T4N LTD</p>
                            <p>Email: <a href="mailto:t4nt3ch@gmail.com" className="text-[#f97316] hover:underline">t4nt3ch@gmail.com</a></p>
                            <p>Website: <a href="https://t4n.dev" target="_blank" rel="noopener noreferrer" className="text-[#f97316] hover:underline">https://t4n.dev</a></p>
                        </div>
                    </Section>
                </div>

                {/* Footer */}
                <div className="mt-16 pt-8 border-t border-[#2a2a35] text-center text-sm text-[#6b7280]">
                    <p>© {new Date().getFullYear()} T4N LTD. All rights reserved.</p>
                </div>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="space-y-3">
            <h2 className="text-xl font-semibold text-[#f97316]">{title}</h2>
            <div className="space-y-2">{children}</div>
        </section>
    );
}