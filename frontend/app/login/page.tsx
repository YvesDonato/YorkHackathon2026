"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import Image from "next/image";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Login failed');
            }

            const data = await response.json();

            // Store token
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('user', JSON.stringify(data.user));

            // Redirect to application page
            window.location.href = '/app';
        } catch (err) {
            setError("Login failed. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a]">
            <div className="w-full max-w-md">
                {/* Logo/Header */}
                <div className="text-center mb-8 animate-fade-in">
                    <div className="relative mx-auto mb-4 h-[72px] w-[72px] overflow-hidden rounded-2xl shadow-lg">
                        <Image
                            src="/prismarineLogo.png"
                            alt="Prismarine logo"
                            fill
                            sizes="72px"
                            className="object-contain p-1"
                            priority
                        />
                    </div>
                    <h1 className="text-3xl font-bold gradient-text mb-2">Welcome Back</h1>
                    <p className="text-[var(--text-secondary)]">Sign in to continue to Prismarine</p>
                </div>

                {/* Login Form */}
                <div className="card-elevated p-8 animate-slide-up" style={{ animationDelay: "100ms" }}>
                    <form onSubmit={handleSubmit} className="space-y-5">
                        {error && (
                            <div className="error-message animate-slide-down">
                                {error}
                            </div>
                        )}

                        {/* Email Field */}
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                                Email Address
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="input-primary w-full"
                                placeholder="you@example.com"
                            />
                        </div>

                        {/* Password Field */}
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-[var(--text-primary)] mb-2">
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="input-primary w-full"
                                placeholder="••••••••"
                            />
                        </div>

                        {/* Remember Me & Forgot Password */}
                        <div className="flex items-center justify-between text-sm">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                    className="w-4 h-4 rounded border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-0"
                                />
                                <span className="text-[var(--text-secondary)]">Remember me</span>
                            </label>
                            <Link href="/forgot-password" className="text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] transition-smooth">
                                Forgot password?
                            </Link>
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full relative overflow-hidden bg-gradient-to-r from-[#a855f7] to-[#ec4899] text-white font-semibold px-6 py-3 rounded-lg shadow-md hover:shadow-[0_0_20px_rgba(168,85,247,0.6)] transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    <span>Signing in...</span>
                                </>
                            ) : (
                                <span>Sign In</span>
                            )}
                        </button>
                    </form>

                    {/* Sign Up Link */}
                    <div className="mt-6 text-center text-sm text-[var(--text-secondary)]">
                        Don't have an account?{" "}
                        <Link href="/signup" className="text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] font-medium transition-smooth">
                            Sign up
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
