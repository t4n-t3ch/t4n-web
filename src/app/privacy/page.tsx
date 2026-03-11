import Link from "next/link";

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-[#0f0f11] text-[#e2e2e8]">
            <div className="max-w-3xl mx-auto px-6 py-16">
                {/* Header */}
                <div className="mb-12">
                    <Link href="/" className="text-[#f97316] hover:underline text-sm mb-6 inline-block">
                        ← Back to T4N
                    </Link>
                    <h1 className="text-4xl font-bold text-[#f97316] mb-2">Privacy Policy</h1>
                    <p className="text-[#9ca3af]">Last Updated: 11/03/2026</p>
                </div>

                {/* Content */}
                <div className="space-y-8 text-[#d1d5db] leading-relaxed">
                    <p className="text-sm text-[#9ca3af] border-l-2 border-[#f97316] pl-4">
                        This Privacy Policy explains how T4N LTD (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) collects, uses, and protects information when you use the T4N platform and related services (&quot;Service&quot;).
                    </p>

                    <p>By using the Service, you agree to the collection and use of information in accordance with this policy.</p>

                    <Section title="1. Information We Collect">
                        <p>We collect information necessary to operate and improve the Service.</p>

                        <h3 className="font-semibold text-[#f97316] mt-4">Account Information</h3>
                        <p>When you create an account, we may collect:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>email address</li>
                            <li>authentication credentials</li>
                            <li>account identifiers</li>
                        </ul>
                        <p className="mt-1">This information is used to manage user accounts and provide access to the Service.</p>

                        <h3 className="font-semibold text-[#f97316] mt-4">User Content</h3>
                        <p>When using the platform, you may create or submit content including:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>code snippets</li>
                            <li>project files</li>
                            <li>chat messages</li>
                            <li>prompts submitted to AI systems</li>
                        </ul>
                        <p className="mt-1">This content is stored in order to provide workspace functionality, project management, and AI interaction features.</p>

                        <h3 className="font-semibold text-[#f97316] mt-4">Usage Data</h3>
                        <p>We may collect limited usage information such as:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>feature usage</li>
                            <li>request activity</li>
                            <li>error logs</li>
                            <li>system performance metrics</li>
                        </ul>
                        <p className="mt-1">This helps us maintain reliability and improve the platform.</p>

                        <h3 className="font-semibold text-[#f97316] mt-4">Payment Information</h3>
                        <p>Payments are processed through third-party payment providers.</p>
                        <p>T4N does not store credit card information directly.</p>
                        <p className="mt-2">Payment providers may collect billing information including:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>billing name</li>
                            <li>billing address</li>
                            <li>payment method details</li>
                        </ul>
                        <p className="mt-2">Please refer to the payment provider's privacy policy for more details.</p>
                    </Section>

                    <Section title="2. How We Use Your Information">
                        <p>We use collected information to:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>provide and operate the Service</li>
                            <li>authenticate user accounts</li>
                            <li>store projects and code snippets</li>
                            <li>process subscription payments</li>
                            <li>improve system reliability and features</li>
                            <li>detect misuse or security issues</li>
                        </ul>
                        <p className="mt-4 font-semibold">We do not sell personal information to third parties.</p>
                    </Section>

                    <Section title="3. AI Processing">
                        <p>When you submit prompts or code to the platform, that information may be processed by third-party AI model providers in order to generate responses.</p>
                        <p>These providers may temporarily process submitted data to generate results.</p>
                        <p className="mt-2">Examples of providers may include:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>AI model APIs</li>
                            <li>inference services</li>
                            <li>locally hosted AI models</li>
                        </ul>
                        <p className="mt-4 bg-[#1e1e24] p-3 rounded-lg border border-[#2a2a35] text-sm">
                            <span className="font-semibold">Important:</span> Users should avoid submitting sensitive or confidential information when interacting with AI features.
                        </p>
                    </Section>

                    <Section title="4. Third-Party Services">
                        <p>T4N may rely on third-party providers to operate the platform.</p>
                        <p>These may include services such as:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>authentication providers</li>
                            <li>database infrastructure</li>
                            <li>payment processors</li>
                            <li>hosting services</li>
                            <li>AI model providers</li>
                        </ul>
                        <p className="mt-2">These services may process limited information required for their functionality.</p>
                    </Section>

                    <Section title="5. Data Storage">
                        <p>User data including projects, snippets, and conversations may be stored on secure infrastructure managed by the Service or its providers.</p>
                        <p>We take reasonable measures to protect data against unauthorized access or disclosure.</p>
                        <p className="mt-2 text-[#9ca3af] italic">However, no online system can guarantee absolute security.</p>
                    </Section>

                    <Section title="6. Data Retention">
                        <p>We retain data only as long as necessary to operate the Service and provide user functionality.</p>
                        <p>Data may be retained while your account remains active.</p>
                        <p>Users may request account deletion, which will result in removal of associated data where technically feasible.</p>
                    </Section>

                    <Section title="7. Your Rights">
                        <p>Depending on your location, you may have rights regarding your personal data.</p>
                        <p>These may include the right to:</p>
                        <ul className="list-disc pl-6 mt-2 space-y-1">
                            <li>request access to stored data</li>
                            <li>request correction of inaccurate information</li>
                            <li>request deletion of personal data</li>
                            <li>request export of your data</li>
                        </ul>
                        <p className="mt-2">Requests can be made by contacting us using the information below.</p>
                    </Section>

                    <Section title="8. Cookies and Similar Technologies">
                        <p>The Service may use cookies or similar technologies to maintain sessions, authenticate users, and improve functionality.</p>
                        <p>Cookies are small data files stored on your device.</p>
                        <p className="mt-2">You may configure your browser to refuse cookies, though some features of the Service may not function properly without them.</p>
                    </Section>

                    <Section title="9. Children's Privacy">
                        <p>The Service is not intended for use by individuals under the age of 13.</p>
                        <p>We do not knowingly collect personal information from children.</p>
                        <p>If we become aware that personal information from a child has been collected, we will take steps to remove that information.</p>
                    </Section>

                    <Section title="10. Changes to This Policy">
                        <p>We may update this Privacy Policy from time to time.</p>
                        <p>Updates will be posted on this page with a revised "Last Updated" date.</p>
                        <p>Continued use of the Service after updates indicates acceptance of the revised policy.</p>
                    </Section>

                    <Section title="11. Contact">
                        <p>If you have questions about this Privacy Policy or your data, please contact:</p>
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