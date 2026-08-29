import { kaja } from "kaja";
import { Theatre } from "theatre/service";
import { Seating, SeatMap, SeatStatus, Section } from "seating/proto/seating";

const READS = 150;
const READERS = 8;

const { shows } = await Theatre.ListShows({ city: "", theaterId: "", movieId: "", limit: 1, cursor: "" });
const screening = shows[0];

const limit = kaja.rateLimit(Seating, { reserve: 0 });

const reads = kaja.table(["read", "remaining", "resets in", "elapsed"]);
let issued = 0;
let house: SeatMap | undefined;

await Promise.all(
  Array.from({ length: READERS }, async () => {
    while (issued < READS) {
      const read = ++issued;
      const started = Date.now();
      const { response, headers } = await Seating.GetSeatMap({ showId: screening.id }).withHeaders();
      house = response?.seatMap ?? house;
      const reset = headers["ratelimit-reset"];
      reads.row(read, headers["ratelimit-remaining"] ?? "—", reset ? `${reset}s` : "—", `${Date.now() - started} ms`);
    }
  }),
);

kaja.text(
  limit.limit === undefined
    ? `${limit.calls} reads of ${screening.id}, against a box office that publishes no budget.`
    : `${limit.calls} reads of ${screening.id}, on a budget of ${limit.limit}. ${limit.held} waited out the window for ${(limit.waitedMs / 1000).toFixed(1)}s between them, and the box office refused ${limit.refusals}.`,
);

if (!house) throw new Error(`No seat map for ${screening.id}`);

const free = house.sections
  .flatMap((section) => section.rows.flatMap((row) => row.seats))
  .filter((seat) => seat.status === SeatStatus.AVAILABLE)
  .slice(0, 2);

const booking = await kaja.approve(Seating.BookSeats({ showId: screening.id, seatIds: free.map((seat) => seat.id) }));

const tickets = kaja.table(["seat", "section", "row", "price"]);
for (const seat of booking.seats) {
  tickets.row(seat.id, Section[seat.section], seat.row, `$${(seat.priceCents / 100).toFixed(2)}`);
}
