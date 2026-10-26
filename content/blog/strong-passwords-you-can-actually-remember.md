SLUG: strong-passwords-you-can-actually-remember
TITLE: Strong Passwords You Can Actually Remember: Why Length Beats Symbols
EXCERPT: "Use a capital and a symbol" is the worst password advice ever given. The real driver of strength is length and unpredictability. Here is the math simply, the passphrase method that beats it, and the two habits that matter more than the password itself.
TAGS: security, password, privacy, passphrases, mfa

## What Makes a Password Hard to Guess

A password's strength is not how *weird* it looks to a human — it is how many guesses a machine would need to try every possibility. That number is called **entropy**, measured in bits, and it comes from two things: the size of the character set you choose from, and how long the password is. Roughly, entropy = (characters) × log₂(alphabet size).

The key insight most people miss: **length matters far more than complexity**. Adding one more character from a full keyboard is worth far more bits than swapping a lowercase letter for a symbol — and symbols placed predictably (a capital at the front, "!" at the end) add almost nothing, because cracking tools try those patterns *first*. "P@ssw0rd" looks complex and is essentially worthless; it is one of the most-guessed passwords on Earth. Randomness and length are the whole game; cosmetic complexity is a decoy.

## The Human Problem: Random Strings Are Unmemorable

The strongest possible password — 16 random characters like `q7#Kz2!pL9@wXn4%` — is something no one can recall, so people write it down or reuse it, which undoes the strength entirely. And modern attackers don't guess character-by-character online; they run through **billions of offline guesses per second** once they steal a password database, using real leaked wordlists and common substitutions. Anything a human would invent as a "clever" password is already in those lists.

## The Passphrase: Longer and Rememberable

The fix that beats both is a **passphrase**: string together four or more random, unrelated words. Consider something like `correct-horse-battery-staple`-style construction — four words picked by chance from a large dictionary. Four genuinely random words from a 7,000-word list carry around **50+ bits of entropy**, comparable to a long jumbled password, yet each word is easy to picture and recall. Length comes free because words are long, and the visual or absurd image they form ("a stapling battery riding a horse") makes it stick. The magic word is **random**: `hunter2!Janet1` is weak because it is a pattern you chose; `cushion-otter-manor-gallop` is strong because the sequence is unpredictable even though every word is ordinary. Roll the words with dice or a generator rather than picking favourites, because humans are terrible at being random and reuse the same "random" words.

## The Habit That Matters More Than Any Single Password

Even a perfect passphrase fails if you make these two mistakes:

**Reuse.** Using one password everywhere means a single breached website hands an attacker the key to your email, bank and everything else — this is exactly how "credential stuffing" attacks work. Every important account needs its own unique password. Since nobody can remember fifty of them, the real answer is a **password manager**: it generates and stores a long unique password per site, and you remember just one strong master passphrase. This single change defeats most password attacks at a stroke.

**No second factor.** A password is one lock. Turning on **two-factor / multi-factor authentication** adds a second — an app code or hardware key an attacker cannot guess or reuse. Even if your password leaks, MFA usually stops the break-in. For email and financial accounts, MFA is the highest-value security step available to an ordinary person, and it protects you precisely in the scenario a strong password cannot (a leaked or phished password).

## A Practical Checklist

- Default to **length and randomness** over symbols and capitals.
- Use a **password manager** so every account is unique and long; protect it with one strong random master passphrase.
- Turn on **MFA** on email, bank and any account holding money or your identity.
- Never put anything **guessable about you** (birthdays, pet names, phone number) in a password — that is the first thing a targeted attacker tries.

You can generate a genuinely random passphrase or a long random password — with the approximate entropy shown so you can see the difference length makes — on our free [password generator](https://tukuk.org/alat/password), which runs entirely in your browser and sends whatever you type to no server at all.
