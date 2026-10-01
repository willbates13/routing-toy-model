"""The two building blocks of the toy model: boxes and sites.

A box is nothing but a vector of SKU quantities. A site holds boxes, adds up
their vectors, and refuses any box needing a SKU it does not host.
"""

import itertools
import random as r

_box_counter = itertools.count(1)


class Box:
    """A customer box: how many units of each SKU it needs.

    Sparse by nature - a box touches a handful of SKUs and leaves the rest at
    zero. Boxes carry an id so the same box can be followed across executions.
    """

    def __init__(self, skus, box_id=None):
        self.skus = list(skus)
        self.id = box_id if box_id is not None else next(_box_counter)

    def __repr__(self):
        return f"Box({self.skus})"

    def __len__(self):
        return len(self.skus)

    @property
    def units(self):
        return sum(self.skus)

    @property
    def lines(self):
        """How many distinct SKUs the box draws on."""
        return sum(1 for v in self.skus if v)

    @staticmethod
    def random(num=1, n_skus=10, rand=r, min_lines=2, max_lines=4):
        """Boxes drawing a few SKUs each, with one to nine units of each.

        Keep the line count well under the SKU count: a box needing the SKU that
        only one factory hosts is stuck there, and if more than half the boxes
        are stuck at the same factory the even split becomes impossible.
        """
        hi = max(1, min(max_lines, n_skus))
        lo = max(1, min(min_lines, hi))
        boxes = []
        for _ in range(num):
            skus = [0] * n_skus
            for k in rand.sample(range(n_skus), rand.randint(lo, hi)):
                skus[k] = rand.randint(1, 9)
            boxes.append(Box(skus))
        return boxes


class Site:
    """A factory. Holds boxes, tracks SKU totals, and knows what it can host."""

    def __init__(self, boxes=None, skus=None, hosted_skus=None):
        if isinstance(boxes, Box):
            boxes = [boxes]
        self.boxes = list(boxes) if boxes else []
        if skus is not None:
            self.skus = list(skus)
        elif not self.boxes:
            self.skus = []
        else:
            out = [0] * len(self.boxes[0])
            for box in self.boxes:
                for i, v in enumerate(box.skus):
                    out[i] += v
            self.skus = out
        self.hosted_skus = list(hosted_skus) if hosted_skus is not None else None

    def __len__(self):
        return len(self.boxes)

    def is_eligible(self, box):
        """A box can only go here if every SKU it needs is hosted here."""
        if self.hosted_skus is None:
            return True
        return all(v == 0 or self.hosted_skus[i] for i, v in enumerate(box.skus))

    def __add__(self, x):
        boxes = x if isinstance(x, list) else [x]
        if not all(isinstance(b, Box) for b in boxes):
            return NotImplemented

        for box in boxes:
            if not self.is_eligible(box):
                raise ValueError(f"Box {box} is not eligible for this site")

        skus = self.skus[:] if self.skus else [0] * (len(boxes[0]) if boxes else 0)
        for box in boxes:
            for i, v in enumerate(box.skus):
                skus[i] += v

        return Site(self.boxes + boxes, skus, self.hosted_skus)

    def __repr__(self):
        return f"Site(skus={self.skus})"


def count_volume_skus(vol):
    """Total SKU demand across a list of boxes."""
    if not vol:
        return []
    return [sum(x) for x in zip(*[b.skus for b in vol])]
